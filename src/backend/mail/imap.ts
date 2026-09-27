// One IMAP connection per account: folder list, incremental sync, IDLE push and server operations.

import { ImapFlow, type FetchMessageObject, type MessageStructureObject, type ImapFlowOptions } from 'imapflow';
import iconv from 'iconv-lite';
import type { Account, Address, SpecialUse } from '@shared/types';
import { htmlToText, snippetOf } from '@shared/util';
import type { MailStore, NewMessage } from './store';
import { folderId } from './store';

export type AuthProvider = () => Promise<{ user: string; pass?: string; accessToken?: string }>;

export interface SyncResult {
  folderId: string;
  newIds: number[];
  changed: boolean;
  /** First sync of this folder (nothing cached before): new ids are not "new mail" */
  initial: boolean;
}

const NAME_HINTS: [SpecialUse, RegExp][] = [
  ['sent', /^(sent|sent items|sent mail|sent messages|gesendet|gesendete objekte|gesendete elemente|gesendete nachrichten|envoyés|enviados|inviata)$/i],
  ['drafts', /^(drafts|draft|entwürfe|entwurf|brouillons|borradores)$/i],
  ['trash', /^(trash|deleted|deleted items|deleted messages|papierkorb|gelöschte elemente|gelöschte objekte|corbeille|papelera|bin)$/i],
  ['junk', /^(junk|spam|junk e-mail|junk-e-mail|junk email|spamverdacht|unerwünscht)$/i],
  ['archive', /^(archive|archiv|archives|all mail)$/i]
];

const HEADER_KEYS = ['references', 'list-unsubscribe', 'list-id', 'auto-submitted', 'precedence', 'importance', 'x-priority', 'reply-to'];

function mapSpecial(s: string | undefined, name: string, path: string): SpecialUse {
  if (path.toUpperCase() === 'INBOX') return 'inbox';
  switch (s) {
    case '\\Inbox':
      return 'inbox';
    case '\\Sent':
      return 'sent';
    case '\\Drafts':
      return 'drafts';
    case '\\Trash':
      return 'trash';
    case '\\Junk':
      return 'junk';
    case '\\Archive':
      return 'archive';
    case '\\Flagged':
      return 'flagged';
    case '\\All':
      return 'all';
  }
  for (const [kind, re] of NAME_HINTS) if (re.test(name)) return kind;
  return null;
}

function toAddr(list: { name?: string; address?: string }[] | undefined): Address[] {
  return (list ?? []).filter((a) => a.address).map((a) => ({ name: a.name ?? '', address: a.address ?? '' }));
}

function hasAttachment(node: MessageStructureObject | undefined): boolean {
  if (!node) return false;
  if (node.childNodes?.length) return node.childNodes.some(hasAttachment);
  const type = node.type.toLowerCase();
  if (node.disposition === 'attachment') return true;
  if (node.dispositionParameters?.filename || node.parameters?.name) {
    return !(node.disposition === 'inline' && type.startsWith('image/'));
  }
  return false;
}

/** Finds the best body part for a preview snippet */
function previewPart(node: MessageStructureObject | undefined): MessageStructureObject | null {
  if (!node) return null;
  const type = node.type.toLowerCase();
  if (!node.childNodes?.length) {
    if ((type === 'text/plain' || type === 'text/html') && node.disposition !== 'attachment') return { ...node, part: node.part ?? '1' };
    return null;
  }
  let html: MessageStructureObject | null = null;
  for (const c of node.childNodes) {
    const p = previewPart(c);
    if (!p) continue;
    if (p.type.toLowerCase() === 'text/plain') return p;
    html ??= p;
  }
  return html;
}

function decodePart(buf: Buffer, node: MessageStructureObject, binary: boolean): string {
  let data = buf;
  const enc = (node.encoding ?? '').toLowerCase();
  if (!binary) {
    if (enc === 'base64') {
      const s = buf.toString('ascii').replace(/[^A-Za-z0-9+/=]/g, '');
      data = Buffer.from(s.slice(0, s.length - (s.length % 4)), 'base64');
    } else if (enc === 'quoted-printable') {
      const s = buf.toString('binary').replace(/=\r?\n/g, '').replace(/=[0-9A-F]{0,1}$/i, '');
      data = Buffer.from(s.replace(/=([0-9A-F]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), 'binary');
    }
  }
  const charset = (node.parameters?.charset ?? 'utf-8').toLowerCase();
  let text: string;
  try {
    text = iconv.encodingExists(charset) ? iconv.decode(data, charset) : data.toString('utf8');
  } catch {
    text = data.toString('utf8');
  }
  if (node.type.toLowerCase() === 'text/html') text = htmlToText(text.replace(/<[^>]*$/, ''));
  return snippetOf(text.replace(/^>.*$/gm, ''));
}

function headerMap(buf: Buffer | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!buf) return out;
  const lines = buf.toString('utf8').replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/);
  for (const l of lines) {
    const i = l.indexOf(':');
    if (i > 0) out[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  return out;
}

function dateOf(m: FetchMessageObject): number {
  const d = m.envelope?.date ?? m.internalDate;
  const t = d ? new Date(d).getTime() : NaN;
  if (Number.isFinite(t)) return t;
  const i = m.internalDate ? new Date(m.internalDate).getTime() : NaN;
  return Number.isFinite(i) ? i : Date.now();
}

function toNew(accountId: string, fid: string, m: FetchMessageObject, snippet: string): NewMessage {
  const env = m.envelope ?? {};
  const headers = headerMap(m.headers);
  return {
    accountId,
    folderId: fid,
    uid: m.uid,
    messageId: env.messageId ?? '',
    inReplyTo: env.inReplyTo ?? '',
    references: headers['references'] ?? '',
    subject: env.subject ?? '',
    from: toAddr(env.from)[0] ?? toAddr(env.sender)[0] ?? { name: '', address: '' },
    to: toAddr(env.to),
    cc: toAddr(env.cc),
    date: dateOf(m),
    size: m.size ?? 0,
    flags: m.flags ?? new Set(),
    hasAttachments: hasAttachment(m.bodyStructure),
    snippet,
    headers
  };
}

export class ImapAccount {
  private client: ImapFlow | null = null;
  private connecting: Promise<ImapFlow> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private idleFolder = 'INBOX';
  closed = false;
  onPush: (path: string) => void = () => undefined;
  onFlags: (path: string, uid: number, flags: Set<string>) => void = () => undefined;
  onDisconnect: (err: Error | null) => void = () => undefined;

  constructor(
    public account: Account,
    private store: MailStore,
    private auth: AuthProvider
  ) {}

  static async test(account: Account, auth: AuthProvider): Promise<void> {
    const client = new ImapFlow(await ImapAccount.options(account, auth));
    client.on('error', () => undefined);
    await client.connect();
    await client.logout();
  }

  private static async options(account: Account, auth: AuthProvider): Promise<ImapFlowOptions> {
    const a = await auth();
    return {
      host: account.imap.host,
      port: account.imap.port,
      secure: account.imap.security === 'tls',
      doSTARTTLS: account.imap.security === 'starttls' ? true : account.imap.security === 'none' ? false : undefined,
      auth: a.accessToken ? { user: a.user, accessToken: a.accessToken } : { user: a.user, pass: a.pass ?? '' },
      tls: { rejectUnauthorized: !account.imap.allowInvalidCert, servername: account.imap.host },
      logger: false,
      clientInfo: { name: 'KS Mail', version: '0.1.0', vendor: 'KS' },
      connectionTimeout: 30_000,
      greetingTimeout: 15_000,
      maxIdleTime: 5 * 60_000,
      autoIdleDelay: 3000
    } as ImapFlowOptions;
  }

  /** Serialises operations on this account */
  run<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => fn(await this.connection()));
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async connection(): Promise<ImapFlow> {
    if (this.closed) throw new Error('Konto ist getrennt.');
    if (this.client?.usable) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const client = new ImapFlow(await ImapAccount.options(this.account, this.auth));
      client.on('error', (err: Error) => {
        console.warn(`[imap ${this.account.email}]`, err.message);
      });
      client.on('close', () => {
        if (this.client === client) this.client = null;
        if (!this.closed) this.onDisconnect(null);
      });
      client.on('exists', (d: { path: string; count: number; prevCount: number }) => {
        if (process.env['KSMAIL_DEBUG']) console.log('[imap] exists', d);
        if (d.count > d.prevCount) this.onPush(d.path);
      });
      client.on('expunge', (d: { path: string }) => this.onPush(d.path));
      client.on('flags', (d: { path: string; uid?: number; flags: Set<string> }) => {
        if (d.uid) this.onFlags(d.path, d.uid, d.flags);
      });
      await client.connect();
      this.client = client;
      return client;
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const c = this.client;
    this.client = null;
    if (c) {
      try {
        await c.logout();
      } catch {
        c.close();
      }
    }
  }

  /** Re-selects the IDLE folder so the server pushes new mail */
  async idle(): Promise<void> {
    await this.run(async (c) => {
      if (c.mailbox && c.mailbox.path === this.idleFolder) return;
      await c.mailboxOpen(this.idleFolder, { readOnly: false });
    });
  }

  async syncFolders(): Promise<string[]> {
    return this.run(async (c) => {
      const list = await c.list({ statusQuery: { messages: true, unseen: true } });
      const acc = this.account.id;
      const seen = new Set<string>();
      for (const l of list) {
        const id = folderId(acc, l.path);
        seen.add(id);
        const special = mapSpecial(l.specialUse, l.name, l.path);
        if (special === 'inbox') this.idleFolder = l.path;
        this.store.upsertFolder({
          id,
          account_id: acc,
          path: l.path,
          name: l.path.toUpperCase() === 'INBOX' ? 'Posteingang' : l.name,
          delimiter: l.delimiter || '/',
          parent_path: l.parentPath || null,
          special_use: special,
          unread: l.status?.unseen ?? 0,
          total: l.status?.messages ?? 0,
          subscribed: l.subscribed ? 1 : 0,
          selectable: l.flags.has('\\Noselect') || l.flags.has('\\NonExistent') ? 0 : 1
        });
      }
      for (const f of this.store.folders(acc)) if (!seen.has(f.id)) this.store.removeFolder(f.id);
      return [...seen];
    });
  }

  /** Incremental sync of one folder. `initial` = first sync after startup (no notifications). */
  async syncFolder(path: string, limit: number): Promise<SyncResult> {
    return this.run(async (c) => {
      const fid = folderId(this.account.id, path);
      const row = this.store.folderRow(fid);
      if (!row || !row.selectable) return { folderId: fid, newIds: [], changed: false, initial: false };
      const lock = await c.getMailboxLock(path);
      try {
        const mb = c.mailbox;
        if (!mb) return { folderId: fid, newIds: [], changed: false, initial: false };
        let changed = false;
        const validity = mb.uidValidity.toString();
        if (row.uid_validity && row.uid_validity !== validity) {
          this.store.clearFolderMessages(fid);
          changed = true;
        }
        const knownMax = this.store.maxUid(fid);
        const newIds: number[] = [];

        // 1. new messages
        if (mb.exists > 0) {
          let range: string;
          let byUid: boolean;
          if (knownMax <= 0) {
            range = `${Math.max(1, mb.exists - limit + 1)}:*`;
            byUid = false;
          } else {
            range = `${knownMax + 1}:*`;
            byUid = true;
          }
          {
            const fetched: FetchMessageObject[] = [];
            for await (const m of c.fetch(range, { uid: true, flags: true, envelope: true, bodyStructure: true, size: true, internalDate: true, headers: HEADER_KEYS }, { uid: byUid })) {
              if (m.uid > knownMax) fetched.push(m);
            }
            const snippets = await this.fetchSnippets(c, fetched.slice(-300));
            for (const m of fetched) newIds.push(this.store.insert(toNew(this.account.id, fid, m, snippets.get(m.uid) ?? '')));
            if (fetched.length) changed = true;
          }
        }

        // 2. flag changes + 3. deletions for messages we know
        const minUid = this.store.minUid(fid);
        if (minUid > 0 || knownMax > 0) {
          const from = Math.max(1, minUid);
          const useModseq = !!(row.highest_modseq && mb.highestModseq && !mb.noModseq && row.uid_validity === validity);
          if (useModseq) {
            if (BigInt(row.highest_modseq!) < mb.highestModseq!) {
              for await (const m of c.fetch(`${from}:*`, { uid: true, flags: true }, { uid: true, changedSince: BigInt(row.highest_modseq!) })) {
                if (m.uid && m.flags && this.store.updateFlags(fid, m.uid, m.flags)) changed = true;
              }
            }
          } else if (knownMax > 0) {
            for await (const m of c.fetch(`${from}:${knownMax}`, { uid: true, flags: true }, { uid: true })) {
              if (m.uid && m.flags && this.store.updateFlags(fid, m.uid, m.flags)) changed = true;
            }
          }
          const server = await c.search({ uid: `${from}:*` }, { uid: true });
          if (Array.isArray(server)) {
            const present = new Set(server);
            const gone = this.store.uids(fid).filter((u) => u > 0 && !present.has(u));
            if (gone.length && this.store.deleteUids(fid, gone)) changed = true;
          }
        }

        // counts from the server
        const unseen = await c.search({ seen: false }, { uid: true });
        this.store.setFolderCounts(fid, Array.isArray(unseen) ? unseen.length : row.unread, mb.exists);
        this.store.setFolderSync(fid, validity, mb.highestModseq ? mb.highestModseq.toString() : null);
        return { folderId: fid, newIds, changed, initial: !row.uid_validity || row.uid_validity !== validity };
      } finally {
        lock.release();
      }
    });
  }

  /** Loads older messages beyond the initial window */
  async loadOlder(path: string, count: number): Promise<number> {
    return this.run(async (c) => {
      const fid = folderId(this.account.id, path);
      const minUid = this.store.minUid(fid);
      if (minUid <= 1) return 0;
      const lock = await c.getMailboxLock(path);
      try {
        const uids = await c.search({ uid: `1:${minUid - 1}` }, { uid: true });
        if (!Array.isArray(uids) || !uids.length) return 0;
        const pick = uids.sort((a, b) => a - b).slice(-count);
        let n = 0;
        for await (const m of c.fetch(pick.join(','), { uid: true, flags: true, envelope: true, bodyStructure: true, size: true, internalDate: true, headers: HEADER_KEYS }, { uid: true })) {
          this.store.insert(toNew(this.account.id, fid, m, ''));
          n++;
        }
        return n;
      } finally {
        lock.release();
      }
    });
  }

  private async fetchSnippets(c: ImapFlow, msgs: FetchMessageObject[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    const groups = new Map<string, { uid: number; node: MessageStructureObject }[]>();
    for (const m of msgs) {
      const node = previewPart(m.bodyStructure);
      if (!node) continue;
      const key = node.part ?? '1';
      const g = groups.get(key) ?? [];
      g.push({ uid: m.uid, node });
      groups.set(key, g);
    }
    for (const [key, list] of groups) {
      const byUid = new Map(list.map((x) => [x.uid, x.node]));
      try {
        for await (const m of c.fetch(list.map((x) => x.uid).join(','), { uid: true, bodyParts: [{ key, maxLength: 2048 }] }, { uid: true })) {
          const buf = m.bodyParts?.get(key) ?? m.bodyParts?.values().next().value;
          const node = byUid.get(m.uid);
          if (buf && node) out.set(m.uid, decodePart(buf, node, !!m.binaryParts?.has(key)));
        }
      } catch (err) {
        console.warn('[imap] snippet fetch failed', (err as Error).message);
      }
    }
    return out;
  }

  async fetchSource(path: string, uid: number): Promise<Buffer> {
    return this.run(async (c) => {
      const lock = await c.getMailboxLock(path);
      try {
        const m = await c.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
        if (!m || !m.source) throw new Error('Nachricht wurde auf dem Server nicht gefunden.');
        return m.source;
      } finally {
        lock.release();
      }
    });
  }

  async setFlags(path: string, uids: number[], add: string[], remove: string[]): Promise<void> {
    if (!uids.length) return;
    await this.run(async (c) => {
      const lock = await c.getMailboxLock(path);
      try {
        const range = uids.join(',');
        if (add.length) await c.messageFlagsAdd(range, add, { uid: true });
        if (remove.length) await c.messageFlagsRemove(range, remove, { uid: true });
      } finally {
        lock.release();
      }
    });
  }

  async move(path: string, uids: number[], target: string): Promise<Map<number, number> | null> {
    if (!uids.length) return null;
    return this.run(async (c) => {
      const lock = await c.getMailboxLock(path);
      try {
        const r = await c.messageMove(uids.join(','), target, { uid: true });
        return r ? (r.uidMap ?? null) : null;
      } finally {
        lock.release();
      }
    });
  }

  async copy(path: string, uids: number[], target: string): Promise<void> {
    if (!uids.length) return;
    await this.run(async (c) => {
      const lock = await c.getMailboxLock(path);
      try {
        await c.messageCopy(uids.join(','), target, { uid: true });
      } finally {
        lock.release();
      }
    });
  }

  async expunge(path: string, uids: number[] | 'all'): Promise<void> {
    await this.run(async (c) => {
      const lock = await c.getMailboxLock(path);
      try {
        if (uids === 'all') {
          if ((c.mailbox && c.mailbox.exists) || 0) await c.messageDelete('1:*');
        } else if (uids.length) await c.messageDelete(uids.join(','), { uid: true });
      } finally {
        lock.release();
      }
    });
  }

  async append(path: string, raw: Buffer, flags: string[]): Promise<number | null> {
    return this.run(async (c) => {
      const r = await c.append(path, raw, flags, new Date());
      return r ? (r.uid ?? null) : null;
    });
  }

  async createFolder(path: string): Promise<void> {
    await this.run(async (c) => {
      await c.mailboxCreate(path);
      try {
        await c.mailboxSubscribe(path);
      } catch {
        // subscription is optional
      }
    });
  }

  async renameFolder(path: string, newPath: string): Promise<void> {
    await this.run(async (c) => {
      await c.mailboxRename(path, newPath);
    });
  }

  async deleteFolder(path: string): Promise<void> {
    await this.run(async (c) => {
      if (c.mailbox && c.mailbox.path === path) await c.mailboxClose();
      await c.mailboxDelete(path);
    });
  }

  async search(path: string, text: string): Promise<number[]> {
    return this.run(async (c) => {
      const lock = await c.getMailboxLock(path);
      try {
        const r = await c.search({ or: [{ subject: text }, { from: text }, { to: text }, { body: text }] }, { uid: true });
        return Array.isArray(r) ? r : [];
      } finally {
        lock.release();
      }
    });
  }

  /** Ensures the given uids are cached locally (for server search hits outside the sync window) */
  async ensureCached(path: string, uids: number[]): Promise<void> {
    const fid = folderId(this.account.id, path);
    const missing = uids.filter((u) => !this.store.byUid(fid, u)).slice(-500);
    if (!missing.length) return;
    await this.run(async (c) => {
      const lock = await c.getMailboxLock(path);
      try {
        const msgs: FetchMessageObject[] = [];
        for await (const m of c.fetch(missing.join(','), { uid: true, flags: true, envelope: true, bodyStructure: true, size: true, internalDate: true, headers: HEADER_KEYS }, { uid: true })) msgs.push(m);
        const snippets = await this.fetchSnippets(c, msgs);
        for (const m of msgs) this.store.insert(toNew(this.account.id, fid, m, snippets.get(m.uid) ?? ''));
      } finally {
        lock.release();
      }
    });
  }
}
