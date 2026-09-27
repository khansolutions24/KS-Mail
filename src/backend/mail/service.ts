// Mail service: account runners, sync scheduling, local-first operations, bodies, sending, rules.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ParsedMail } from 'mailparser';
import type { AccountTestResult } from '@shared/api';
import type {
  Account,
  Address,
  Draft,
  Folder,
  MessageBody,
  MessageHeader,
  MessagePage,
  MessageQuery,
  OutboxItem,
  RuleAction,
  SpecialUse,
  SyncState
} from '@shared/types';
import { VIRTUAL } from '@shared/types';
import { applicableRules, needsBody, type RuleSubject } from '@shared/rules';
import { escapeHtml, formatAddressList, htmlToText, isValidEmail, newId, parseAddressList, prefixSubject, safeFileName, snippetOf } from '@shared/util';
import { emit, toast } from '../events';
import { platform } from '../platform';
import type { ConfigStore } from '../store/config';
import type { Db } from '../store/db';
import { DemoRemote } from './demo';
import { ImapAccount, type AuthProvider, type SyncResult } from './imap';
import { accessToken, ConsentRequiredError, forgetToken, GRAPH_SCOPE } from './oauth';
import { checkAccess, sendMime } from './graph';
import { attachmentInfos, buildBody, parseRaw } from './parse';
import type { Remote } from './remote';
import { buildMessage, sendRaw, testSmtp, type ExtraParts } from './send';
import { folderId, MailStore, toHeader, type FolderRow, type MessageRow } from './store';

const SKIP_SYNC: SpecialUse[] = ['all', 'flagged'];

export interface MailHooks {
  collectRecipients(list: Address[]): void;
  isContact(address: string): boolean;
}

interface Runner {
  remote: Remote;
  timer: NodeJS.Timeout | null;
  pushTimers: Map<string, NodeJS.Timeout>;
  idleTimer: NodeJS.Timeout | null;
  retry: number;
  state: SyncState;
  syncing: Promise<void> | null;
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export class MailService {
  readonly store: MailStore;
  private runners = new Map<string, Runner>();
  private bodyCache = new Map<number, { parsed: ParsedMail; body: MessageBody }>();
  private cacheDir: string;
  private outboxTimer: NodeJS.Timeout | null = null;
  private snoozeTimer: NodeJS.Timeout | null = null;
  hooks: MailHooks = { collectRecipients: () => undefined, isContact: () => false };

  constructor(
    private db: Db,
    private config: ConfigStore,
    private dataDir: string
  ) {
    this.store = new MailStore(db);
    this.cacheDir = path.join(dataDir, 'cache');
  }

  // ───────────────────────── lifecycle ─────────────────────────

  start(): void {
    for (const a of this.config.listAccounts()) if (a.enabled) this.startAccount(a);
    // sending state from a previous session
    this.db.run(`UPDATE outbox SET status = 'queued' WHERE status = 'sending'`);
    this.outboxTimer = setInterval(() => void this.processOutbox(), 1000);
    this.snoozeTimer = setInterval(() => this.wakeSnoozed(), 30_000);
    this.updateBadge();
  }

  async stop(): Promise<void> {
    if (this.outboxTimer) clearInterval(this.outboxTimer);
    if (this.snoozeTimer) clearInterval(this.snoozeTimer);
    await Promise.all([...this.runners.keys()].map((id) => this.stopAccount(id)));
  }

  authFor(account: Account): AuthProvider {
    return async () => {
      const secret = this.config.getSecret(account.id);
      if (account.auth === 'oauth2' && account.oauthProvider) {
        if (!secret.refreshToken) throw new Error('Nicht angemeldet – bitte in den Kontoeinstellungen anmelden.');
        const token = await accessToken(account.id, account.oauthProvider, secret.refreshToken, this.config.getSettings(), (rt) =>
          this.config.setSecret(account.id, { ...this.config.getSecret(account.id), refreshToken: rt })
        );
        return { user: account.imap.user || account.email, accessToken: token };
      }
      return { user: account.imap.user || account.email, pass: account.imap.password ?? secret.password ?? '' };
    };
  }

  /** Microsoft account signed in with OAuth: Graph is available for sending and the calendar */
  usesGraph(a: Account): boolean {
    return a.kind === 'imap' && a.auth === 'oauth2' && a.oauthProvider === 'microsoft';
  }

  private sendsViaGraph(a: Account): boolean {
    const via = a.sendVia ?? 'auto';
    return via === 'graph' || (via === 'auto' && this.usesGraph(a));
  }

  /** Access token for Microsoft Graph (Mail.Send, Calendars.ReadWrite) */
  async graphToken(accountId: string): Promise<string> {
    const a = this.config.getAccount(accountId);
    if (!a || !this.usesGraph(a)) throw new Error('Microsoft 365 ist nur für Microsoft-Konten mit OAuth-Anmeldung verfügbar.');
    const secret = this.config.getSecret(a.id);
    if (!secret.refreshToken) throw new Error('Nicht angemeldet – bitte in den Kontoeinstellungen mit Microsoft anmelden.');
    try {
      return await accessToken(
        a.id,
        'microsoft',
        secret.refreshToken,
        this.config.getSettings(),
        (rt) => this.config.setSecret(a.id, { ...this.config.getSecret(a.id), refreshToken: rt }),
        GRAPH_SCOPE
      );
    } catch (err) {
      if (err instanceof ConsentRequiredError) {
        throw new Error('Für Senden und Kalender über Microsoft 365 ist eine erneute Anmeldung nötig: Einstellungen → Konten → Konto bearbeiten → „Mit Microsoft anmelden“.');
      }
      throw err;
    }
  }

  private smtpAuthFor(account: Account): AuthProvider {
    const base = this.authFor(account);
    return async () => {
      const a = await base();
      if (a.accessToken) return { ...a, user: account.smtp.user || a.user };
      const secret = this.config.getSecret(account.id);
      return { user: account.smtp.user || a.user, pass: account.smtp.password || secret.smtpPassword || a.pass };
    };
  }

  startAccount(a: Account): void {
    if (this.runners.has(a.id)) return;
    const remote: Remote = a.kind === 'demo' ? new DemoRemote(a, this.store, this.dataDir) : new ImapAccount(a, this.store, this.authFor(a));
    const r: Runner = {
      remote,
      timer: null,
      pushTimers: new Map(),
      idleTimer: null,
      retry: 0,
      state: { accountId: a.id, status: 'idle', message: '', lastSync: null },
      syncing: null
    };
    this.runners.set(a.id, r);
    remote.onPush = (p) => {
      const t = r.pushTimers.get(p);
      if (t) clearTimeout(t);
      r.pushTimers.set(
        p,
        setTimeout(() => {
          r.pushTimers.delete(p);
          void this.syncOne(a.id, p).catch((err) => console.warn('[mail] push sync failed', describeError(err)));
        }, 700)
      );
    };
    remote.onFlags = (p, uid, flags) => {
      const fid = folderId(a.id, p);
      if (this.store.updateFlags(fid, uid, flags)) this.changed(a.id, [fid]);
    };
    remote.onDisconnect = () => {
      if (!this.runners.has(a.id) || a.kind === 'demo') return;
      this.setState(a.id, 'offline', 'Verbindung getrennt – neuer Versuch …');
      const delay = Math.min(300_000, 5000 * 2 ** r.retry++);
      setTimeout(() => {
        if (this.runners.get(a.id) === r) void this.syncAccount(a.id).catch(() => undefined);
      }, delay);
    };
    void this.syncAccount(a.id).catch(() => undefined);
    const interval = Math.max(1, a.syncInterval || 5) * 60_000;
    r.timer = setInterval(() => void this.syncAccount(a.id).catch(() => undefined), interval);
  }

  async stopAccount(id: string): Promise<void> {
    const r = this.runners.get(id);
    if (!r) return;
    this.runners.delete(id);
    if (r.timer) clearInterval(r.timer);
    if (r.idleTimer) clearTimeout(r.idleTimer);
    for (const t of r.pushTimers.values()) clearTimeout(t);
    await r.remote.close().catch(() => undefined);
  }

  async restartAccount(a: Account): Promise<void> {
    await this.stopAccount(a.id);
    forgetToken(a.id);
    if (a.enabled) this.startAccount(a);
  }

  async removeAccount(id: string): Promise<void> {
    await this.stopAccount(id);
    this.store.deleteAccount(id);
    this.db.run('DELETE FROM outbox WHERE account_id = ?', id);
    fs.rmSync(path.join(this.cacheDir, id), { recursive: true, force: true });
    fs.rmSync(path.join(this.dataDir, 'demo', id), { recursive: true, force: true });
    this.updateBadge();
  }

  async seedDemo(a: Account): Promise<void> {
    const demo = new DemoRemote(a, this.store, this.dataDir);
    await demo.seed();
  }

  async test(a: Account): Promise<AccountTestResult> {
    const res: AccountTestResult = { imap: { ok: false, message: '' }, smtp: { ok: false, message: '' } };
    if (a.kind === 'demo') return { imap: { ok: true, message: 'Demo' }, smtp: { ok: true, message: 'Demo' } };
    const auth = this.authFor(a);
    try {
      await ImapAccount.test(a, auth);
      res.imap = { ok: true, message: 'Verbindung erfolgreich' };
    } catch (err) {
      res.imap = { ok: false, message: describeError(err) };
    }
    try {
      if (this.sendsViaGraph(a) && this.config.getAccount(a.id)) {
        await checkAccess(await this.graphToken(a.id));
        res.smtp = { ok: true, message: 'Versand über Microsoft 365 (Graph) möglich' };
        return res;
      }
      await testSmtp(a, this.smtpAuthFor(a));
      res.smtp = { ok: true, message: 'Verbindung erfolgreich' };
    } catch (err) {
      res.smtp = { ok: false, message: describeError(err) };
    }
    return res;
  }

  private runner(accountId: string): Runner {
    const r = this.runners.get(accountId);
    if (!r) throw new Error('Das Konto ist deaktiviert oder existiert nicht.');
    return r;
  }

  private setState(accountId: string, status: SyncState['status'], message: string): void {
    const r = this.runners.get(accountId);
    if (!r) return;
    r.state = { ...r.state, status, message, lastSync: status === 'idle' ? Date.now() : r.state.lastSync };
    emit('sync:state', r.state);
  }

  syncStates(): SyncState[] {
    return [...this.runners.values()].map((r) => r.state);
  }

  private changed(accountId: string, folderIds: string[]): void {
    emit('mail:changed', { accountId, folderIds });
    this.updateBadge();
  }

  private updateBadge(): void {
    const s = this.config.getSettings();
    platform().setBadge(s.notifications.badge ? this.store.unreadInboxCount() : 0);
  }

  private scheduleIdle(r: Runner): void {
    if (r.idleTimer) clearTimeout(r.idleTimer);
    r.idleTimer = setTimeout(() => void r.remote.idle().catch(() => undefined), 1500);
  }

  // ───────────────────────── sync ─────────────────────────

  async syncAll(): Promise<void> {
    await Promise.all([...this.runners.keys()].map((id) => this.syncAccount(id).catch(() => undefined)));
  }

  async syncAccount(accountId: string): Promise<void> {
    const r = this.runner(accountId);
    if (r.syncing) return r.syncing;
    r.syncing = (async () => {
      const a = r.remote.account;
      this.setState(accountId, 'syncing', 'Ordner werden synchronisiert …');
      try {
        await r.remote.syncFolders();
        emit('folders:changed', { accountId });
        const folders = this.store
          .folders(accountId)
          .filter((f) => f.selectable && !SKIP_SYNC.includes(f.specialUse) && (f.subscribed || f.specialUse))
          .sort((x, y) => rank(x) - rank(y));
        for (const f of folders) {
          if (!this.runners.has(accountId)) return;
          this.setState(accountId, 'syncing', `${f.name} wird synchronisiert …`);
          const res = await r.remote.syncFolder(f.path, a.initialLimit || 500);
          await this.afterSync(a, f, res);
        }
        r.retry = 0;
        this.setState(accountId, 'idle', '');
        emit('folders:changed', { accountId });
        this.scheduleIdle(r);
      } catch (err) {
        this.setState(accountId, 'error', describeError(err));
        throw err;
      } finally {
        r.syncing = null;
      }
    })();
    return r.syncing;
  }

  async syncOne(accountId: string, p: string): Promise<void> {
    const r = this.runner(accountId);
    const row = this.store.folderRow(folderId(accountId, p));
    if (!row) return;
    const res = await r.remote.syncFolder(p, r.remote.account.initialLimit || 500);
    await this.afterSync(r.remote.account, { specialUse: row.special_use as SpecialUse, id: row.id }, res);
    emit('folders:changed', { accountId });
    this.scheduleIdle(r);
  }

  async syncRequest(accountId?: string, fid?: string): Promise<void> {
    if (fid && !fid.startsWith('virtual:')) {
      const row = this.store.folderRow(fid);
      if (row && this.runners.has(row.account_id)) return this.syncOne(row.account_id, row.path);
      return;
    }
    if (accountId) return this.syncAccount(accountId);
    await this.syncAll();
  }

  async loadMore(fid: string): Promise<number> {
    const row = this.store.folderRow(fid);
    if (!row) return 0;
    const n = await this.runner(row.account_id).remote.loadOlder(row.path, 200);
    if (n) this.changed(row.account_id, [fid]);
    return n;
  }

  private async afterSync(a: Account, f: Pick<Folder, 'specialUse' | 'id'>, res: SyncResult): Promise<void> {
    if (res.changed) this.changed(a.id, [res.folderId]);
    if (res.initial || !res.newIds.length || f.specialUse !== 'inbox') return;
    const rows = this.store.byIds(res.newIds).filter((m) => !m.seen);
    const kept = await this.applyRulesTo(a, rows);
    this.notifyNew(a, kept);
    await this.outOfOffice(a, rows);
  }

  private notifyNew(a: Account, rows: MessageRow[]): void {
    const s = this.config.getSettings().notifications;
    if (!s.enabled || !rows.length || inQuietHours(s.quietHoursFrom, s.quietHoursTo)) return;
    if (rows.length > 3) {
      platform().notify(`${rows.length} neue E-Mails`, a.name || a.email, () => emit('command', { command: 'open.folder', arg: rows[0].folder_id }), !s.sound);
    } else {
      for (const m of rows) {
        platform().notify(
          m.from_name || m.from_addr,
          s.showPreview ? `${m.subject}\n${m.snippet}`.slice(0, 200) : m.subject,
          () => emit('command', { command: 'open.message', arg: String(m.id) }),
          !s.sound
        );
      }
    }
    emit('notify', { kind: 'mail', title: rows.length === 1 ? rows[0].from_name || rows[0].from_addr : `${rows.length} neue E-Mails`, body: rows[0].subject, ref: { messageId: rows[0].id } });
  }

  private wakeSnoozed(): void {
    const due = this.store.dueSnoozes(Date.now());
    if (!due.length) return;
    this.store.setColumn(
      due.map((d) => d.id),
      'snoozed_until',
      null
    );
    for (const m of due) {
      this.store.setLocal([m.id], 'seen', false);
      platform().notify('Zurückgestellte E-Mail', `${m.from_name || m.from_addr}: ${m.subject}`, () => emit('command', { command: 'open.message', arg: String(m.id) }));
    }
    for (const acc of new Set(due.map((d) => d.account_id))) this.changed(acc, due.filter((d) => d.account_id === acc).map((d) => d.folder_id));
  }

  // ───────────────────────── rules ─────────────────────────

  private async subjectFor(a: Account, m: MessageRow, withBody: boolean): Promise<RuleSubject> {
    const h = toHeader(m);
    let body = '';
    let headers: Record<string, string> = {};
    try {
      headers = JSON.parse(m.headers_json) as Record<string, string>;
    } catch {
      headers = {};
    }
    if (withBody) {
      try {
        body = (await this.body(m.id)).text;
      } catch {
        body = m.snippet;
      }
    }
    return { accountId: a.id, from: h.from, to: h.to, cc: h.cc, subject: h.subject, body, hasAttachments: h.hasAttachments, size: h.size, headers };
  }

  /** Applies rules and blocked senders; returns messages still unread in the inbox (for notifications) */
  private async applyRulesTo(a: Account, rows: MessageRow[]): Promise<MessageRow[]> {
    const s = this.config.getSettings();
    const blocked = new Set(s.blockedSenders.map((b) => b.toLowerCase()));
    const rules = s.rules.filter((r) => r.enabled && (!r.accountId || r.accountId === a.id));
    const withBody = needsBody(rules);
    const kept: MessageRow[] = [];
    for (const m of rows) {
      const addr = m.from_addr.toLowerCase();
      if (blocked.has(addr) || blocked.has('@' + addr.split('@')[1])) {
        await this.junk([m.id], true).catch(() => undefined);
        continue;
      }
      if (!rules.length) {
        kept.push(m);
        continue;
      }
      const subj = await this.subjectFor(a, m, withBody);
      const hits = applicableRules(rules, subj);
      const actions = hits.flatMap((r) => r.actions);
      if (actions.length) await this.applyActions([m.id], actions).catch((err) => toast('error', `Regel fehlgeschlagen: ${describeError(err)}`));
      const after = this.store.byId(m.id);
      if (after && !after.seen && after.folder_id === m.folder_id) kept.push(after);
    }
    return kept;
  }

  async runRules(fid: string): Promise<number> {
    const row = this.store.folderRow(fid);
    if (!row) return 0;
    const a = this.config.getAccount(row.account_id);
    if (!a) return 0;
    const page = this.store.list({ folderId: fid, limit: 5000 }, []);
    const rows = this.store.byIds(page.items.map((i) => i.id));
    const s = this.config.getSettings();
    const rules = s.rules.filter((r) => r.enabled && (!r.accountId || r.accountId === a.id));
    const withBody = needsBody(rules);
    let n = 0;
    for (const m of rows) {
      const hits = applicableRules(rules, await this.subjectFor(a, m, withBody));
      const actions = hits.flatMap((r) => r.actions);
      if (!actions.length) continue;
      await this.applyActions([m.id], actions);
      n++;
    }
    return n;
  }

  async applyActions(ids: number[], actions: RuleAction[]): Promise<void> {
    let current = ids;
    for (const act of actions) {
      if (!current.length) return;
      switch (act.type) {
        case 'markRead':
          await this.setFlags(current, { seen: true });
          break;
        case 'flag':
          await this.setFlags(current, { flagged: true });
          break;
        case 'pin':
          await this.setFlags(current, { pinned: true });
          break;
        case 'category': {
          for (const row of this.store.byIds(current)) {
            const cats = new Set(toHeader(row).categories);
            cats.add(act.category);
            this.store.setColumn([row.id], 'categories', JSON.stringify([...cats]));
          }
          this.changedRows(this.store.byIds(current));
          break;
        }
        case 'delete':
          await this.remove(current, false);
          current = [];
          break;
        case 'move':
        case 'copy': {
          const groups = groupBy(this.store.byIds(current), (r) => r.account_id);
          for (const [acc, rows] of groups) {
            const target = await this.resolvePath(acc, act.folderPath);
            if (!target) throw new Error(`Ordner "${act.folderPath}" nicht gefunden.`);
            if (act.type === 'move') await this.move(rows.map((r) => r.id), target);
            else await this.copy(rows.map((r) => r.id), target);
          }
          if (act.type === 'move') current = [];
          break;
        }
        case 'forward': {
          for (const id of current) {
            const d = await this.prepare('forward', id);
            d.to = [{ name: '', address: act.to }];
            await this.enqueue(d, 0);
          }
          break;
        }
        case 'notify': {
          const rows = this.store.byIds(current);
          for (const r of rows) platform().notify(act.text || 'Regel', `${r.from_name || r.from_addr}: ${r.subject}`, () => emit('command', { command: 'open.message', arg: String(r.id) }));
          break;
        }
      }
    }
  }

  /** '@archive', '@trash', … or a folder path/id */
  private async resolvePath(accountId: string, p: string): Promise<string | null> {
    if (p.startsWith('@')) {
      const special = p.slice(1) as SpecialUse;
      const f = special === 'archive' ? await this.archiveFolder(accountId) : this.store.folderBySpecial(accountId, special);
      return f?.id ?? null;
    }
    if (this.store.folderRow(p)) return p;
    const id = folderId(accountId, p);
    return this.store.folderRow(id) ? id : null;
  }

  private async outOfOffice(a: Account, rows: MessageRow[]): Promise<void> {
    const o = this.config.getSettings().outOfOffice;
    const now = Date.now();
    if (!o.enabled || (o.from && now < o.from) || (o.to && now > o.to)) return;
    const period = `${o.from ?? 0}-${o.to ?? 0}`;
    const sent = this.db.kvGet<Record<string, string>>('ooo.sent', {});
    for (const m of rows) {
      let h: Record<string, string> = {};
      try {
        h = JSON.parse(m.headers_json) as Record<string, string>;
      } catch {
        h = {};
      }
      const addr = m.from_addr.toLowerCase();
      if (!addr || addr === a.email.toLowerCase() || /no-?reply|mailer-daemon|postmaster/i.test(addr)) continue;
      if (h['list-id'] || /bulk|list|junk/i.test(h['precedence'] ?? '') || (h['auto-submitted'] && h['auto-submitted'] !== 'no')) continue;
      if (o.onlyContacts && !this.hooks.isContact(addr)) continue;
      if (sent[`${a.id}:${addr}`] === period) continue;
      sent[`${a.id}:${addr}`] = period;
      const d: Draft = {
        id: newId(),
        accountId: a.id,
        to: [{ name: m.from_name, address: m.from_addr }],
        cc: [],
        bcc: [],
        subject: `${o.subject || 'Abwesenheitsnotiz'}: ${m.subject}`,
        html: `<div>${escapeHtml(o.text).replace(/\n/g, '<br>')}</div>`,
        attachments: [],
        inReplyTo: m.message_id,
        references: [m.message_id]
      };
      await this.enqueue(d, 0, { headers: { 'Auto-Submitted': 'auto-replied' } });
    }
    this.db.kvSet('ooo.sent', sent);
  }

  // ───────────────────────── queries ─────────────────────────

  folders(accountId?: string): Folder[] {
    return this.store.folders(accountId);
  }

  list(q: MessageQuery): MessagePage {
    const enabled = this.config.listAccounts().filter((a) => a.enabled).map((a) => a.id);
    return this.store.list(q, q.folderId.startsWith('virtual:') ? enabled : []);
  }

  get(id: number): MessageHeader | null {
    const r = this.store.byId(id);
    return r ? toHeader(r) : null;
  }

  thread(id: number): MessageHeader[] {
    const r = this.store.byId(id);
    return r ? this.store.thread(r) : [];
  }

  private cacheFile(row: MessageRow, folder: FolderRow): string {
    const key = crypto.createHash('sha1').update(`${folder.path}\u0000${folder.uid_validity ?? ''}`).digest('hex').slice(0, 16);
    return path.join(this.cacheDir, row.account_id, key, `${row.uid}.eml`);
  }

  async rawSource(id: number): Promise<{ raw: Buffer; row: MessageRow }> {
    const row = this.store.byId(id);
    if (!row) throw new Error('Nachricht nicht gefunden.');
    const folder = this.store.folderRow(row.folder_id);
    if (!folder) throw new Error('Ordner nicht gefunden.');
    const file = this.cacheFile(row, folder);
    if (row.uid > 0 && fs.existsSync(file)) return { raw: await fs.promises.readFile(file), row };
    if (row.uid < 0) throw new Error('Die Nachricht wird gerade verschoben – bitte gleich erneut versuchen.');
    const raw = await this.runner(row.account_id).remote.fetchSource(folder.path, row.uid);
    if (this.config.getAccount(row.account_id)?.kind !== 'demo') {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, raw);
    }
    return { raw, row };
  }

  private async parsed(id: number): Promise<{ parsed: ParsedMail; body: MessageBody }> {
    const hit = this.bodyCache.get(id);
    if (hit) return hit;
    const { raw, row } = await this.rawSource(id);
    const parsed = await parseRaw(raw);
    const body = buildBody(id, parsed);
    if (!row.snippet && body.text) this.store.setSnippet(id, snippetOf(body.text));
    this.bodyCache.set(id, { parsed, body });
    if (this.bodyCache.size > 40) this.bodyCache.delete(this.bodyCache.keys().next().value!);
    return { parsed, body };
  }

  async body(id: number): Promise<MessageBody> {
    return (await this.parsed(id)).body;
  }

  async attachment(id: number, index: number): Promise<{ filename: string; contentType: string; content: Buffer }> {
    const { parsed } = await this.parsed(id);
    const a = parsed.attachments[index];
    if (!a) throw new Error('Anhang nicht gefunden.');
    const info = attachmentInfos(parsed)[index];
    return { filename: info.filename, contentType: a.contentType, content: a.content };
  }

  async saveAttachment(id: number, index: number): Promise<string | null> {
    const a = await this.attachment(id, index);
    const target = await platform().saveDialog({ title: 'Anhang speichern', defaultPath: path.join(os.homedir(), 'Downloads', safeFileName(a.filename)) });
    if (!target) return null;
    await fs.promises.writeFile(target, a.content);
    return target;
  }

  async saveAllAttachments(id: number): Promise<string | null> {
    const { parsed } = await this.parsed(id);
    const dirs = await platform().openDialog({ title: 'Zielordner für Anhänge', directory: true });
    if (!dirs[0]) return null;
    const infos = attachmentInfos(parsed);
    for (const [i, a] of parsed.attachments.entries()) {
      if (infos[i].inline) continue;
      await fs.promises.writeFile(uniquePath(dirs[0], safeFileName(infos[i].filename)), a.content);
    }
    return dirs[0];
  }

  async openAttachment(id: number, index: number): Promise<void> {
    const a = await this.attachment(id, index);
    if (BLOCKED_EXT.test(a.filename.trim())) {
      throw new Error(`„${a.filename}“ ist ein ausführbarer Dateityp und wird aus Sicherheitsgründen nicht direkt geöffnet. Speichern Sie die Datei, wenn Sie ihr vertrauen.`);
    }
    const dir = path.join(os.tmpdir(), 'ks-mail', String(id));
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, safeFileName(a.filename));
    await fs.promises.writeFile(file, a.content);
    await platform().openPath(file);
  }

  async saveAs(id: number): Promise<string | null> {
    const { raw, row } = await this.rawSource(id);
    const target = await platform().saveDialog({
      title: 'Nachricht speichern',
      defaultPath: path.join(os.homedir(), 'Documents', safeFileName(row.subject || 'Nachricht') + '.eml'),
      filters: [{ name: 'E-Mail', extensions: ['eml'] }]
    });
    if (!target) return null;
    await fs.promises.writeFile(target, raw);
    return target;
  }

  async source(id: number): Promise<string> {
    return (await this.rawSource(id)).raw.toString('utf8');
  }

  async importEml(fid: string): Promise<number> {
    const row = this.store.folderRow(fid);
    if (!row) throw new Error('Bitte zuerst einen Ordner auswählen.');
    const files = await platform().openDialog({ title: 'E-Mails importieren', filters: [{ name: 'E-Mail', extensions: ['eml'] }], multi: true });
    const r = this.runner(row.account_id);
    for (const f of files) await r.remote.append(row.path, await fs.promises.readFile(f), ['\\Seen']);
    if (files.length) await this.syncOne(row.account_id, row.path);
    return files.length;
  }

  async printHtml(id: number): Promise<void> {
    const h = this.get(id);
    const b = await this.body(id);
    if (!h) return;
    const head = `<h2 style="font-family:Segoe UI,Arial;margin:0 0 8px">${escapeHtml(h.subject)}</h2>
      <table style="font:13px Segoe UI,Arial;color:#333;margin-bottom:12px">
      <tr><td><b>Von:</b></td><td>${escapeHtml(formatAddressList([h.from]))}</td></tr>
      <tr><td><b>Gesendet:</b></td><td>${escapeHtml(fmtDate(h.date))}</td></tr>
      <tr><td><b>An:</b></td><td>${escapeHtml(formatAddressList(h.to))}</td></tr>
      ${h.cc.length ? `<tr><td><b>Cc:</b></td><td>${escapeHtml(formatAddressList(h.cc))}</td></tr>` : ''}
      ${b.attachments.filter((a) => !a.inline).length ? `<tr><td><b>Anlagen:</b></td><td>${b.attachments.filter((a) => !a.inline).map((a) => escapeHtml(a.filename)).join(', ')}</td></tr>` : ''}
      </table><hr>`;
    // remote content stays blocked when printing; scripts are disabled in the print window
    const csp = `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:`;
    await platform().printHtml(`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><body>${head}${b.html ?? ''}</body>`);
  }

  async serverSearch(fid: string, text: string): Promise<MessagePage> {
    const targets = fid.startsWith('virtual:') ? this.store.folders().filter((f) => f.specialUse === 'inbox') : [this.store.folderRow(fid)].filter(Boolean).map((r) => ({ id: r!.id, accountId: r!.account_id, path: r!.path }));
    const ids: number[] = [];
    for (const f of targets) {
      const r = this.runners.get(f.accountId);
      if (!r) continue;
      const uids = await r.remote.search(f.path, text);
      await r.remote.ensureCached(f.path, uids);
      for (const u of uids) {
        const row = this.store.byUid(f.id, u);
        if (row) ids.push(row.id);
      }
    }
    const items = this.store.byIds(ids).map(toHeader).sort((a, b) => b.date - a.date);
    return { total: items.length, items };
  }

  // ───────────────────────── operations ─────────────────────────

  private changedRows(rows: MessageRow[]): void {
    for (const [acc, list] of groupBy(rows, (r) => r.account_id)) this.changed(acc, [...new Set(list.map((r) => r.folder_id))]);
  }

  private background(accountId: string, what: string, p: Promise<unknown>, resyncFolders: string[] = []): void {
    p.catch(async (err) => {
      toast('error', `${what} fehlgeschlagen: ${describeError(err)}`);
      for (const fid of resyncFolders) {
        const row = this.store.folderRow(fid);
        if (row) await this.syncOne(accountId, row.path).catch(() => undefined);
      }
    });
  }

  async setFlags(ids: number[], f: { seen?: boolean; flagged?: boolean; pinned?: boolean; dueAt?: number | null }): Promise<void> {
    const rows = this.store.byIds(ids);
    if (!rows.length) return;
    if (f.pinned !== undefined) this.store.setLocal(ids, 'pinned', f.pinned);
    if (f.dueAt !== undefined) this.store.setColumn(ids, 'due_at', f.dueAt);
    if (f.seen !== undefined) {
      for (const [fid, list] of groupBy(rows, (r) => r.folder_id)) {
        const delta = list.filter((r) => !!r.seen !== f.seen).length;
        if (delta) this.store.adjustUnread(fid, f.seen ? -delta : delta);
      }
      this.store.setLocal(ids, 'seen', f.seen);
    }
    if (f.flagged !== undefined) {
      this.store.setLocal(ids, 'flagged', f.flagged);
      if (!f.flagged) this.store.setColumn(ids, 'due_at', null);
    }
    this.changedRows(rows);
    if (f.seen === undefined && f.flagged === undefined) return;
    for (const [fid, list] of groupBy(rows, (r) => r.folder_id)) {
      const folder = this.store.folderRow(fid);
      const r = this.runners.get(list[0].account_id);
      if (!folder || !r) continue;
      const add: string[] = [];
      const remove: string[] = [];
      if (f.seen !== undefined) (f.seen ? add : remove).push('\\Seen');
      if (f.flagged !== undefined) (f.flagged ? add : remove).push('\\Flagged');
      const uids = list.map((m) => m.uid).filter((u) => u > 0);
      this.background(list[0].account_id, 'Markieren', r.remote.setFlags(folder.path, uids, add, remove), [fid]);
      this.scheduleIdle(r);
    }
  }

  setCategories(ids: number[], categories: string[]): void {
    this.store.setColumn(ids, 'categories', JSON.stringify(categories));
    this.changedRows(this.store.byIds(ids));
  }

  snooze(ids: number[], until: number | null): void {
    this.store.setColumn(ids, 'snoozed_until', until);
    if (until) this.store.setLocal(ids, 'seen', true);
    this.changedRows(this.store.byIds(ids));
  }

  async move(ids: number[], target: string): Promise<void> {
    const trow = this.store.folderRow(target);
    if (!trow) throw new Error('Zielordner nicht gefunden.');
    const rows = this.store.byIds(ids).filter((r) => r.folder_id !== target);
    if (!rows.length) return;
    for (const [fid, list] of groupBy(rows, (r) => r.folder_id)) {
      const src = this.store.folderRow(fid);
      if (!src) continue;
      if (src.account_id !== trow.account_id) {
        await this.crossAccountMove(list, src, trow);
        continue;
      }
      const r = this.runner(src.account_id);
      assertSettled(list);
      const unread = list.filter((m) => !m.seen).length;
      const uids = list.map((m) => m.uid);
      const byUid = new Map(list.map((m) => [m.uid, m.id]));
      // local first: placeholders with negative uids in the target
      for (const m of list) this.store.moveRow(m.id, target, this.store.nextTempUid(target));
      this.store.adjustUnread(fid, -unread);
      this.store.adjustTotal(fid, -list.length);
      this.store.adjustUnread(target, unread);
      this.store.adjustTotal(target, list.length);
      this.changed(src.account_id, [fid, target]);
      const op = r.remote.move(src.path, uids, trow.path).then(async (map) => {
        if (map && map.size) {
          for (const [oldUid, newUid] of map) {
            const id = byUid.get(oldUid);
            if (id !== undefined) this.store.moveRow(id, target, newUid);
          }
        } else {
          this.store.deleteIds(list.map((m) => m.id));
          await r.remote.syncFolder(trow.path, r.remote.account.initialLimit);
        }
        this.changed(src.account_id, [target]);
      });
      this.background(src.account_id, 'Verschieben', op, [fid, target]);
      this.scheduleIdle(r);
    }
  }

  private async crossAccountMove(list: MessageRow[], src: FolderRow, target: FolderRow): Promise<void> {
    const rs = this.runner(src.account_id);
    const rt = this.runner(target.account_id);
    for (const m of list) {
      const { raw } = await this.rawSource(m.id);
      await rt.remote.append(target.path, raw, m.seen ? ['\\Seen'] : []);
    }
    await rs.remote.expunge(
      src.path,
      list.map((m) => m.uid).filter((u) => u > 0)
    );
    this.store.deleteIds(list.map((m) => m.id));
    await this.syncOne(src.account_id, src.path);
    await this.syncOne(target.account_id, target.path);
  }

  async copy(ids: number[], target: string): Promise<void> {
    const trow = this.store.folderRow(target);
    if (!trow) throw new Error('Zielordner nicht gefunden.');
    for (const [fid, list] of groupBy(this.store.byIds(ids), (r) => r.folder_id)) {
      const src = this.store.folderRow(fid)!;
      if (src.account_id !== trow.account_id) {
        const rt = this.runner(trow.account_id);
        for (const m of list) await rt.remote.append(trow.path, (await this.rawSource(m.id)).raw, m.seen ? ['\\Seen'] : []);
      } else {
        await this.runner(src.account_id).remote.copy(
          src.path,
          list.map((m) => m.uid).filter((u) => u > 0),
          trow.path
        );
      }
    }
    await this.syncOne(trow.account_id, trow.path);
  }

  /** True when the messages would be deleted for good (no trash folder, or already in trash/junk) */
  isPermanentDelete(ids: number[]): boolean {
    return this.store.byIds(ids).some((m) => {
      const src = this.store.folderRow(m.folder_id);
      return !src || src.special_use === 'trash' || src.special_use === 'junk' || !this.store.folderBySpecial(m.account_id, 'trash');
    });
  }

  async remove(ids: number[], permanent: boolean): Promise<void> {
    const rows = this.store.byIds(ids);
    assertSettled(rows);
    for (const [fid, list] of groupBy(rows, (r) => r.folder_id)) {
      const src = this.store.folderRow(fid);
      if (!src) continue;
      const trash = this.store.folderBySpecial(src.account_id, 'trash');
      if (permanent || !trash || src.special_use === 'trash' || src.special_use === 'junk') {
        const r = this.runner(src.account_id);
        this.store.deleteIds(list.map((m) => m.id));
        this.store.adjustUnread(fid, -list.filter((m) => !m.seen).length);
        this.store.adjustTotal(fid, -list.length);
        this.changed(src.account_id, [fid]);
        this.background(
          src.account_id,
          'Löschen',
          r.remote.expunge(
            src.path,
            list.map((m) => m.uid).filter((u) => u > 0)
          ),
          [fid]
        );
      } else {
        await this.move(
          list.map((m) => m.id),
          trash.id
        );
      }
    }
  }

  private async archiveFolder(accountId: string): Promise<FolderRow | undefined> {
    const existing = this.store.folderBySpecial(accountId, 'archive') ?? this.store.folderBySpecial(accountId, 'all');
    if (existing) return existing;
    const r = this.runner(accountId);
    const name = 'Archive';
    await r.remote.createFolder(name);
    await r.remote.syncFolders();
    const row = this.store.folderRow(folderId(accountId, name));
    if (row) this.db.run(`UPDATE folders SET special_use = 'archive' WHERE id = ?`, row.id);
    emit('folders:changed', { accountId });
    return this.store.folderRow(folderId(accountId, name));
  }

  async archive(ids: number[]): Promise<void> {
    for (const [acc, list] of groupBy(this.store.byIds(ids), (r) => r.account_id)) {
      const target = await this.archiveFolder(acc);
      if (!target) throw new Error('Kein Archivordner vorhanden.');
      await this.move(
        list.map((m) => m.id),
        target.id
      );
    }
  }

  async junk(ids: number[], isJunk: boolean): Promise<void> {
    for (const [acc, list] of groupBy(this.store.byIds(ids), (r) => r.account_id)) {
      let target = this.store.folderBySpecial(acc, isJunk ? 'junk' : 'inbox');
      if (!target && isJunk) {
        await this.runner(acc).remote.createFolder('Junk');
        await this.runner(acc).remote.syncFolders();
        this.db.run(`UPDATE folders SET special_use = 'junk' WHERE id = ?`, folderId(acc, 'Junk'));
        target = this.store.folderRow(folderId(acc, 'Junk'));
      }
      if (!target) continue;
      for (const [fid, rows] of groupBy(list, (r) => r.folder_id)) {
        const src = this.store.folderRow(fid);
        if (src)
          await this.runner(acc)
            .remote.setFlags(
              src.path,
              rows.map((r) => r.uid).filter((u) => u > 0),
              [isJunk ? '$Junk' : '$NotJunk'],
              [isJunk ? '$NotJunk' : '$Junk']
            )
            .catch(() => undefined);
      }
      await this.move(
        list.map((m) => m.id),
        target.id
      );
    }
  }

  async blockSender(id: number): Promise<void> {
    const row = this.store.byId(id);
    if (!row) return;
    const s = this.config.getSettings();
    if (!s.blockedSenders.includes(row.from_addr.toLowerCase())) {
      this.config.updateSettings({ blockedSenders: [...s.blockedSenders, row.from_addr.toLowerCase()] });
      emit('settings:changed', this.config.getSettings());
    }
    await this.junk([id], true);
  }

  async markFolderRead(fid: string): Promise<void> {
    const page = this.store.list({ folderId: fid, filter: 'unread', limit: 100000 }, fid.startsWith('virtual:') ? [] : []);
    await this.setFlags(
      page.items.map((m) => m.id),
      { seen: true }
    );
    if (!fid.startsWith('virtual:')) this.store.setFolderCounts(fid, 0, this.store.folderRow(fid)?.total ?? 0);
  }

  async emptyFolder(fid: string): Promise<void> {
    const row = this.store.folderRow(fid);
    if (!row) return;
    this.store.clearFolderMessages(fid);
    this.store.setFolderCounts(fid, 0, 0);
    this.changed(row.account_id, [fid]);
    await this.runner(row.account_id).remote.expunge(row.path, 'all');
  }

  async createFolder(accountId: string, parentPath: string | null, name: string): Promise<void> {
    const clean = name.trim();
    if (!clean) throw new Error('Bitte einen Ordnernamen eingeben.');
    const parent = parentPath ? this.store.folderRow(folderId(accountId, parentPath)) : undefined;
    const delim = parent?.delimiter ?? this.store.folders(accountId)[0]?.delimiter ?? '/';
    const r = this.runner(accountId);
    await r.remote.createFolder(parentPath ? `${parentPath}${delim}${clean}` : clean);
    await r.remote.syncFolders();
    emit('folders:changed', { accountId });
  }

  async renameFolder(fid: string, newName: string): Promise<void> {
    const row = this.store.folderRow(fid);
    if (!row) return;
    const newPath = row.parent_path ? `${row.parent_path}${row.delimiter}${newName.trim()}` : newName.trim();
    const r = this.runner(row.account_id);
    await r.remote.renameFolder(row.path, newPath);
    await r.remote.syncFolders();
    await this.syncOne(row.account_id, newPath).catch(() => undefined);
    emit('folders:changed', { accountId: row.account_id });
  }

  async deleteFolder(fid: string): Promise<void> {
    const row = this.store.folderRow(fid);
    if (!row) return;
    if (row.special_use) throw new Error('Systemordner können nicht gelöscht werden.');
    const r = this.runner(row.account_id);
    await r.remote.deleteFolder(row.path);
    this.store.removeFolder(fid);
    await r.remote.syncFolders();
    emit('folders:changed', { accountId: row.account_id });
  }

  setFavorite(fid: string, fav: boolean): void {
    this.store.setFavorite(fid, fav);
    const row = this.store.folderRow(fid);
    if (row) emit('folders:changed', { accountId: row.account_id });
  }

  async unsubscribe(id: number): Promise<string> {
    const b = await this.body(id);
    const row = this.store.byId(id);
    if (!b.listUnsubscribe || !row) throw new Error('Diese Nachricht enthält keinen Abmelde-Link.');
    if (b.listUnsubscribe.startsWith('mailto:')) {
      const url = new URL(b.listUnsubscribe);
      // exactly one valid recipient; subject/body come from the sender and are sent as plain text
      const to = parseAddressList(decodeURIComponent(url.pathname)).filter((x) => isValidEmail(x.address));
      if (to.length !== 1) throw new Error('Der Abmelde-Link dieser Nachricht ist ungültig.');
      await this.enqueue(
        {
          id: newId(),
          accountId: row.account_id,
          to,
          cc: [],
          bcc: [],
          subject: (url.searchParams.get('subject') ?? 'unsubscribe').slice(0, 200),
          html: escapeHtml(url.searchParams.get('body') ?? 'unsubscribe').slice(0, 2000),
          attachments: [],
          plainText: true
        },
        0
      );
      return 'Abmelde-E-Mail wurde gesendet.';
    }
    await platform().openExternal(b.listUnsubscribe);
    return 'Abmeldeseite wurde im Browser geöffnet.';
  }

  // ───────────────────────── compose & send ─────────────────────────

  private quoteHeader(h: MessageHeader): string {
    return `<div style="border:none;border-top:solid #e1e1e1 1pt;padding:3pt 0 0 0;font-family:Segoe UI,Arial,sans-serif;font-size:11pt">
<b>Von:</b> ${escapeHtml(formatAddressList([h.from]))}<br>
<b>Gesendet:</b> ${escapeHtml(fmtDate(h.date))}<br>
<b>An:</b> ${escapeHtml(formatAddressList(h.to))}<br>${h.cc.length ? `<b>Cc:</b> ${escapeHtml(formatAddressList(h.cc))}<br>` : ''}
<b>Betreff:</b> ${escapeHtml(h.subject)}</div><br>`;
  }

  async prepare(mode: 'reply' | 'replyAll' | 'forward' | 'edit', id: number): Promise<Draft> {
    const h = this.get(id);
    if (!h) throw new Error('Nachricht nicht gefunden.');
    const b = await this.body(id);
    const acc = this.config.getAccount(h.accountId);
    const me = (acc?.email ?? '').toLowerCase();
    const draft: Draft = { id: newId(), accountId: h.accountId, to: [], cc: [], bcc: [], subject: h.subject, html: '', attachments: [], mode, sourceMessageId: id };
    const bodyHtml = stripDocument(b.html ?? '');
    if (mode === 'edit') {
      draft.to = h.to;
      draft.cc = h.cc;
      draft.bcc = b.bcc;
      draft.html = bodyHtml;
      draft.inReplyTo = h.inReplyTo || undefined;
      draft.references = b.references;
      draft.serverDraftMessageId = id;
      draft.attachments = b.attachments.filter((a) => !a.inline).map((a) => ({ id: newId(), filename: a.filename, contentType: a.contentType, size: a.size, fromMessage: { messageId: id, index: a.index } }));
      return draft;
    }
    const quote = `<br><div id="ks-quote">${this.quoteHeader(h)}<div>${bodyHtml}</div></div>`;
    draft.html = quote;
    if (mode === 'forward') {
      draft.subject = prefixSubject('WG', h.subject);
      draft.attachments = b.attachments.filter((a) => !a.inline).map((a) => ({ id: newId(), filename: a.filename, contentType: a.contentType, size: a.size, fromMessage: { messageId: id, index: a.index } }));
      draft.references = [...b.references, h.messageId].filter(Boolean);
      return draft;
    }
    draft.subject = prefixSubject('AW', h.subject);
    draft.inReplyTo = h.messageId || undefined;
    draft.references = [...b.references, h.messageId].filter(Boolean);
    const sentByMe = h.from.address.toLowerCase() === me;
    const primary = sentByMe ? h.to : b.replyTo.length ? b.replyTo : [h.from];
    draft.to = primary;
    if (mode === 'replyAll') {
      const seen = new Set(primary.map((a) => a.address.toLowerCase()));
      seen.add(me);
      const others = [...(sentByMe ? [] : h.to), ...h.cc].filter((a) => {
        const k = a.address.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      draft.cc = others;
    }
    return draft;
  }

  private outboxRows(): { id: string; account_id: string; draft_json: string; send_at: number; status: string; error: string }[] {
    return this.db.all('SELECT * FROM outbox ORDER BY send_at');
  }

  outbox(): OutboxItem[] {
    return this.outboxRows().map((r) => {
      const d = JSON.parse(r.draft_json) as Draft;
      return { id: r.id, accountId: r.account_id, subject: d.subject, to: formatAddressList(d.to), sendAt: r.send_at, status: r.status as OutboxItem['status'], error: r.error };
    });
  }

  async send(draft: Draft): Promise<string> {
    const all = [...draft.to, ...draft.cc, ...draft.bcc];
    if (!all.length) throw new Error('Bitte mindestens einen Empfänger angeben.');
    const bad = all.find((a) => !isValidEmail(a.address));
    if (bad) throw new Error(`Ungültige E-Mail-Adresse: ${bad.address}`);
    if (!this.config.getAccount(draft.accountId)) throw new Error('Absenderkonto nicht gefunden.');
    const delay = draft.sendAt && draft.sendAt > Date.now() ? draft.sendAt - Date.now() : this.config.getSettings().mail.undoSendSeconds * 1000;
    const id = await this.enqueue(draft, delay);
    this.db.run('DELETE FROM local_drafts WHERE id = ?', draft.id);
    return id;
  }

  private async enqueue(draft: Draft, delayMs: number, extra?: ExtraParts): Promise<string> {
    const id = newId();
    this.db.run('INSERT INTO outbox(id, account_id, draft_json, send_at, status) VALUES(?,?,?,?,?)', id, draft.accountId, JSON.stringify({ ...draft, extra }), Date.now() + delayMs, 'queued');
    emit('outbox:changed', null);
    if (delayMs <= 0) void this.processOutbox();
    return id;
  }

  cancelOutbox(id: string): Draft | null {
    const row = this.db.get<{ draft_json: string; status: string }>('SELECT draft_json, status FROM outbox WHERE id = ?', id);
    if (!row || row.status === 'sending') return null;
    this.db.run('DELETE FROM outbox WHERE id = ?', id);
    emit('outbox:changed', null);
    const d = JSON.parse(row.draft_json) as Draft & { extra?: unknown };
    delete d.extra;
    return d;
  }

  retryOutbox(id: string): void {
    this.db.run(`UPDATE outbox SET status = 'queued', error = '', send_at = ? WHERE id = ?`, Date.now(), id);
    emit('outbox:changed', null);
    void this.processOutbox();
  }

  private sendingNow = false;

  private async processOutbox(): Promise<void> {
    if (this.sendingNow) return;
    this.sendingNow = true;
    try {
      const due = this.db.all<{ id: string; draft_json: string }>(`SELECT id, draft_json FROM outbox WHERE status = 'queued' AND send_at <= ? ORDER BY send_at`, Date.now());
      for (const item of due) {
        // claim atomically: the user may have cancelled (undo send) while earlier items were being delivered
        if (!this.db.run(`UPDATE outbox SET status = 'sending' WHERE id = ? AND status = 'queued'`, item.id).changes) continue;
        emit('outbox:changed', null);
        const d = JSON.parse(item.draft_json) as Draft & { extra?: ExtraParts };
        try {
          await this.deliver(d, d.extra);
          this.db.run('DELETE FROM outbox WHERE id = ?', item.id);
          if (!d.extra?.headers?.['Auto-Submitted']) toast('success', `Gesendet: ${d.subject || '(Ohne Betreff)'}`);
        } catch (err) {
          this.db.run(`UPDATE outbox SET status = 'failed', error = ? WHERE id = ?`, describeError(err), item.id);
          platform().notify('Senden fehlgeschlagen', `${d.subject}: ${describeError(err)}`);
          toast('error', `Senden fehlgeschlagen: ${describeError(err)}`);
        }
        emit('outbox:changed', null);
      }
    } finally {
      this.sendingNow = false;
    }
  }

  /** Sends immediately (used by the outbox and for calendar replies) */
  async deliver(d: Draft, extra?: ExtraParts): Promise<void> {
    const a = this.config.getAccount(d.accountId);
    if (!a) throw new Error('Absenderkonto nicht gefunden.');
    const msg = await buildMessage(a, d, (ref) => this.attachment(ref.messageId, ref.index), extra);
    const viaGraph = this.sendsViaGraph(a);
    if (viaGraph) await sendMime(await this.graphToken(a.id), msg.raw);
    else if (a.kind !== 'demo') await sendRaw(a, this.smtpAuthFor(a), msg);
    const r = this.runners.get(a.id);
    // Exchange stores sent mail itself when sending through Graph
    if (r && !viaGraph && (a.saveSent || a.kind === 'demo')) {
      let sent = this.store.folderBySpecial(a.id, 'sent');
      if (!sent) {
        await r.remote.createFolder('Sent').catch(() => undefined);
        await r.remote.syncFolders();
        this.db.run(`UPDATE folders SET special_use = 'sent' WHERE id = ?`, folderId(a.id, 'Sent'));
        sent = this.store.folderRow(folderId(a.id, 'Sent'));
      }
      if (sent) {
        await r.remote.append(sent.path, msg.raw, ['\\Seen']).catch((err) => toast('error', `Kopie in „Gesendet“ fehlgeschlagen: ${describeError(err)}`));
        void this.syncOne(a.id, sent.path).catch(() => undefined);
      }
    } else if (r) {
      const sent = this.store.folderBySpecial(a.id, 'sent');
      if (sent) setTimeout(() => void this.syncOne(a.id, sent.path).catch(() => undefined), 3000);
    }
    if (d.sourceMessageId && (d.mode === 'reply' || d.mode === 'replyAll' || d.mode === 'forward')) {
      const src = this.store.byId(d.sourceMessageId);
      if (src) {
        this.store.setLocal([src.id], d.mode === 'forward' ? 'forwarded' : 'answered', true);
        const f = this.store.folderRow(src.folder_id);
        if (f && r && src.uid > 0) await r.remote.setFlags(f.path, [src.uid], [d.mode === 'forward' ? '$Forwarded' : '\\Answered'], []).catch(() => undefined);
        this.changed(a.id, [src.folder_id]);
      }
    }
    if (d.serverDraftMessageId) await this.removeServerDraft(d.serverDraftMessageId);
    if (this.config.getSettings().mail.collectRecipients) this.hooks.collectRecipients([...d.to, ...d.cc, ...d.bcc]);
  }

  private async removeServerDraft(id: number): Promise<void> {
    const row = this.store.byId(id);
    if (!row) return;
    await this.remove([id], true).catch(() => undefined);
  }

  private draftChains = new Map<string, Promise<unknown>>();
  /** Latest server copy per local draft id (a second save must replace that one, not the stale id it was given) */
  private draftServerIds = new Map<string, number | undefined>();

  saveDraft(d: Draft): Promise<Draft> {
    const prev = this.draftChains.get(d.id) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => this.saveDraftNow({ ...d, serverDraftMessageId: this.draftServerIds.has(d.id) ? this.draftServerIds.get(d.id) : d.serverDraftMessageId }));
    this.draftChains.set(d.id, next);
    return next;
  }

  private async saveDraftNow(d: Draft): Promise<Draft> {
    const a = this.config.getAccount(d.accountId);
    if (!a) throw new Error('Absenderkonto nicht gefunden.');
    this.saveLocalDraft(d);
    const r = this.runner(a.id);
    let drafts = this.store.folderBySpecial(a.id, 'drafts');
    if (!drafts) {
      await r.remote.createFolder('Drafts').catch(() => undefined);
      await r.remote.syncFolders();
      this.db.run(`UPDATE folders SET special_use = 'drafts' WHERE id = ?`, folderId(a.id, 'Drafts'));
      drafts = this.store.folderRow(folderId(a.id, 'Drafts'));
    }
    if (!drafts) throw new Error('Kein Entwürfe-Ordner vorhanden.');
    const msg = await buildMessage(a, d, (ref) => this.attachment(ref.messageId, ref.index));
    const uid = await r.remote.append(drafts.path, msg.raw, ['\\Seen', '\\Draft']);
    // attachments from the previous server copy are embedded now; keep references valid before deleting it
    const old = d.serverDraftMessageId;
    await r.remote.syncFolder(drafts.path, a.initialLimit);
    // servers without UIDPLUS return no uid: find the copy by its Message-ID
    const row = uid ? this.store.byUid(drafts.id, uid) : this.db.get<MessageRow>('SELECT * FROM messages WHERE folder_id = ? AND message_id = ? ORDER BY uid DESC LIMIT 1', drafts.id, msg.messageId);
    const next: Draft = { ...d, serverDraftMessageId: row?.id };
    this.draftServerIds.set(d.id, row?.id);
    if (row) {
      const b = await this.body(row.id).catch(() => null);
      if (b) next.attachments = b.attachments.filter((x) => !x.inline).map((x) => ({ id: newId(), filename: x.filename, contentType: x.contentType, size: x.size, fromMessage: { messageId: row.id, index: x.index } }));
    }
    if (old && old !== row?.id) await this.removeServerDraft(old);
    this.changed(a.id, [drafts.id]);
    this.saveLocalDraft(next);
    return next;
  }

  async discardDraft(d: Draft): Promise<void> {
    await this.draftChains.get(d.id)?.catch(() => undefined);
    this.db.run('DELETE FROM local_drafts WHERE id = ?', d.id);
    const serverId = this.draftServerIds.has(d.id) ? this.draftServerIds.get(d.id) : d.serverDraftMessageId;
    this.draftServerIds.delete(d.id);
    this.draftChains.delete(d.id);
    if (serverId) await this.removeServerDraft(serverId);
  }

  localDrafts(): Draft[] {
    return this.db.all<{ draft_json: string }>('SELECT draft_json FROM local_drafts ORDER BY updated DESC').map((r) => JSON.parse(r.draft_json) as Draft);
  }

  saveLocalDraft(d: Draft): void {
    this.db.run(
      'INSERT INTO local_drafts(id, draft_json, updated) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET draft_json = excluded.draft_json, updated = excluded.updated',
      d.id,
      JSON.stringify(d),
      Date.now()
    );
  }

  removeLocalDraft(id: string): void {
    this.db.run('DELETE FROM local_drafts WHERE id = ?', id);
  }

  async pickFiles(): Promise<{ filename: string; contentType: string; size: number; path: string }[]> {
    const files = await platform().openDialog({ title: 'Dateien anfügen', multi: true });
    return files.map((f) => ({ filename: path.basename(f), contentType: mimeFor(f), size: fs.statSync(f).size, path: f }));
  }

  clearCache(): void {
    fs.rmSync(this.cacheDir, { recursive: true, force: true });
    this.bodyCache.clear();
  }

  searchAll(text: string): MessageHeader[] {
    return this.store.searchAll(text, 15);
  }
}

function rank(f: Folder): number {
  const order: Record<string, number> = { inbox: 0, sent: 2, drafts: 3, archive: 4, junk: 6, trash: 7 };
  return f.specialUse ? (order[f.specialUse] ?? 5) : 5;
}

function groupBy<T>(list: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const k = key(x);
    const arr = m.get(k) ?? [];
    arr.push(x);
    m.set(k, arr);
  }
  return m;
}

/** Body of a message for quoting. Style sheets are dropped: in the composer they would apply to the whole app. */
function stripDocument(html: string): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return (body ? body[1] : html).replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
}

function assertSettled(rows: MessageRow[]): void {
  if (rows.some((r) => r.uid <= 0)) throw new Error('Die Nachricht wird gerade noch verschoben – bitte einen Moment warten und erneut versuchen.');
}

const BLOCKED_EXT = /\.(exe|com|bat|cmd|msi|msp|scr|pif|vbs|vbe|js|jse|wsf|wsh|hta|lnk|ps1|psm1|reg|cpl|jar|app|command|pkg|dmg|scpt|sh|appref-ms|iso|img|vhd|vhdx)$/i;

function uniquePath(dir: string, name: string): string {
  let p = path.join(dir, name);
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}

export function describeError(err: unknown): string {
  const e = err as { message?: string; responseText?: string; response?: string; authenticationFailed?: boolean; code?: string };
  if (e?.authenticationFailed) return 'Anmeldung fehlgeschlagen – Benutzername oder Passwort falsch (ggf. App-Passwort verwenden).';
  if (e?.code === 'ENOTFOUND') return 'Server nicht gefunden – bitte Servernamen prüfen.';
  if (e?.code === 'ECONNREFUSED') return 'Verbindung abgelehnt – bitte Port und Verschlüsselung prüfen.';
  if (e?.code === 'ETIMEDOUT' || e?.code === 'ETIMEOUT') return 'Zeitüberschreitung bei der Verbindung.';
  const text = `${e?.response ?? ''} ${e?.message ?? ''}`;
  if (/5\.7\.139|SmtpClientAuthentication is disabled/i.test(text)) {
    return 'Microsoft 365 erlaubt für dieses Konto keinen SMTP-Versand (SMTP AUTH ist im Mandanten abgeschaltet). Lösung: Konto mit „Mit Microsoft anmelden“ (OAuth) einrichten – KS Mail sendet dann über Microsoft Graph. Alternativ kann ein Administrator SMTP AUTH für das Postfach aktivieren.';
  }
  if (e?.code === 'EAUTH') return `Anmeldung am SMTP-Server fehlgeschlagen: ${e.response ?? e.message ?? ''}`;
  return e?.responseText || e?.message || String(err);
}

function inQuietHours(from: string, to: string): boolean {
  if (!from || !to) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  const f = fh * 60 + fm;
  const t = th * 60 + tm;
  return f <= t ? cur >= f && cur < t : cur >= f || cur < t;
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  ics: 'text/calendar',
  vcf: 'text/vcard',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  eml: 'message/rfc822',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4'
};

export function mimeFor(file: string): string {
  return MIME[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream';
}
