// Composes the backend services into the RPC `Api` and dispatches `namespace.method` calls.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Api } from '@shared/api';
import type { Account, Calendar, CalendarEvent, Contact, Note, SearchHit, Settings, Task, TaskList } from '@shared/types';
import { contactName } from '@shared/vcard';
import { defaultAccount } from '@shared/defaults';
import { newId } from '@shared/util';
import { emit, toast } from './events';
import { platform } from './platform';
import { ConfigStore } from './store/config';
import { Db } from './store/db';
import { autoConfig } from './mail/autoconfig';
import { oauthLogin, primeToken } from './mail/oauth';
import { MailService, describeError } from './mail/service';
import { CalendarService } from './pim/calendar';
import { ContactService } from './pim/contacts';
import { TaskService } from './pim/tasks';

export interface Backend {
  api: Api;
  mail: MailService;
  calendar: CalendarService;
  config: ConfigStore;
  db: Db;
  shutdown(): Promise<void>;
}

interface ExportBundle {
  app: 'ks-mail';
  version: 1;
  settings: Settings;
  accounts: Account[];
  calendars: Calendar[];
  events: CalendarEvent[];
  contacts: Contact[];
  taskLists: TaskList[];
  tasks: Task[];
  notes: Note[];
}

export function createBackend(): Backend {
  const dataDir = platform().dataDir;
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Db(path.join(dataDir, 'ksmail.db'));
  const config = new ConfigStore(dataDir);
  const mail = new MailService(db, config, dataDir);
  const contacts = new ContactService(db);
  const calendar = new CalendarService(db, config, mail);
  const tasks = new TaskService(db, mail);
  mail.hooks = { collectRecipients: (l) => contacts.collect(l), isContact: (a) => contacts.isContact(a) };

  const applyLoginItem = (s: Settings): void => platform().setLoginItem(s.launchAtLogin, s.startMinimized);

  const api: Api = {
    accounts: {
      list: async () => config.listAccounts(),
      save: async (a) => {
        const isNew = !config.getAccount(a.id);
        const saved = config.saveAccount({ ...a, imap: { ...a.imap, user: a.imap.user || a.email }, smtp: { ...a.smtp, user: a.smtp.user || a.imap.user || a.email } });
        if (isNew && !config.getSettings().defaultAccountId) config.updateSettings({ defaultAccountId: saved.id });
        await mail.restartAccount(saved);
        emit('accounts:changed', null);
        return saved;
      },
      remove: async (id) => {
        await mail.removeAccount(id);
        config.removeAccount(id);
        if (config.getSettings().defaultAccountId === id) config.updateSettings({ defaultAccountId: config.listAccounts()[0]?.id ?? null });
        emit('accounts:changed', null);
      },
      test: async (a) => {
        const secret = config.getSecret(a.id);
        const withPw: Account = { ...a, imap: { ...a.imap, user: a.imap.user || a.email, password: a.imap.password || secret.password }, smtp: { ...a.smtp, user: a.smtp.user || a.imap.user || a.email, password: a.smtp.password || secret.smtpPassword || a.imap.password || secret.password } };
        return mail.test(withPw);
      },
      autoConfig: (email) => autoConfig(email),
      oauthLogin: async (accountId, provider, email) => {
        const r = await oauthLogin(provider, email, config.getSettings());
        config.setSecret(accountId, { ...config.getSecret(accountId), refreshToken: r.refreshToken });
        primeToken(accountId, r.accessToken, r.expires);
        const a = config.getAccount(accountId);
        if (a) await mail.restartAccount(a);
        emit('accounts:changed', null);
      },
      reorder: async (ids) => {
        config.reorder(ids);
        emit('accounts:changed', null);
      },
      addDemo: async () => {
        const a: Account = {
          ...defaultAccount(),
          kind: 'demo',
          name: 'Demo-Konto',
          displayName: 'Alex Beispiel',
          email: `alex.beispiel.${newId().slice(-4)}@demo.ksmail`,
          color: '#8764b8',
          imap: { host: 'demo', port: 0, security: 'none', user: 'demo' },
          smtp: { host: 'demo', port: 0, security: 'none', user: 'demo' }
        };
        const saved = config.saveAccount(a);
        await mail.seedDemo(saved);
        if (!config.getSettings().defaultAccountId) config.updateSettings({ defaultAccountId: saved.id });
        mail.startAccount(saved);
        emit('accounts:changed', null);
        emit('folders:changed', { accountId: saved.id });
        return saved;
      }
    },
    mail: {
      folders: async (accountId) => mail.folders(accountId),
      list: async (q) => mail.list(q),
      get: async (id) => mail.get(id),
      body: async (id) => mail.body(id),
      thread: async (id) => mail.thread(id),
      setFlags: (ids, f) => mail.setFlags(ids, f),
      setCategories: async (ids, c) => mail.setCategories(ids, c),
      snooze: async (ids, until) => mail.snooze(ids, until),
      move: (ids, target) => mail.move(ids, target),
      copy: (ids, target) => mail.copy(ids, target),
      remove: (ids, permanent) => mail.remove(ids, !!permanent),
      archive: (ids) => mail.archive(ids),
      junk: (ids, isJunk) => mail.junk(ids, isJunk),
      markFolderRead: (id) => mail.markFolderRead(id),
      emptyFolder: (id) => mail.emptyFolder(id),
      createFolder: (acc, parent, name) => mail.createFolder(acc, parent, name),
      renameFolder: (id, name) => mail.renameFolder(id, name),
      deleteFolder: (id) => mail.deleteFolder(id),
      setFavorite: async (id, fav) => mail.setFavorite(id, fav),
      sync: (acc, fid) => mail.syncRequest(acc, fid),
      loadMore: (fid) => mail.loadMore(fid),
      syncState: async () => mail.syncStates(),
      serverSearch: (fid, text) => mail.serverSearch(fid, text),
      saveAttachment: (id, i) => mail.saveAttachment(id, i),
      saveAllAttachments: (id) => mail.saveAllAttachments(id),
      openAttachment: (id, i) => mail.openAttachment(id, i),
      attachmentData: async (id, i) => {
        const a = await mail.attachment(id, i);
        return { filename: a.filename, contentType: a.contentType, dataBase64: a.content.toString('base64') };
      },
      saveAs: (id) => mail.saveAs(id),
      source: (id) => mail.source(id),
      importEml: (fid) => mail.importEml(fid),
      print: (id) => mail.printHtml(id),
      applyActions: (ids, actions) => mail.applyActions(ids, actions),
      unsubscribe: (id) => mail.unsubscribe(id),
      blockSender: (id) => mail.blockSender(id)
    },
    compose: {
      prepare: (mode, id) => mail.prepare(mode, id),
      send: (d) => mail.send(d),
      saveDraft: (d) => mail.saveDraft(d),
      discardDraft: (d) => mail.discardDraft(d),
      pickFiles: () => mail.pickFiles(),
      outbox: async () => mail.outbox(),
      cancelOutbox: async (id) => mail.cancelOutbox(id),
      retryOutbox: async (id) => mail.retryOutbox(id),
      localDrafts: async () => mail.localDrafts(),
      saveLocalDraft: async (d) => mail.saveLocalDraft(d),
      removeLocalDraft: async (id) => mail.removeLocalDraft(id),
      suggest: async (text) => contacts.suggest(text, mail.store.recipients(text, 10))
    },
    calendar: {
      calendars: async () => calendar.calendars(),
      saveCalendar: async (c) => {
        const saved = calendar.saveCalendar(c);
        if (saved.subscriptionUrl) void calendar.refreshSubscription(saved.id).catch((err) => toast('error', `Abonnement: ${describeError(err)}`));
        return saved;
      },
      removeCalendar: async (id) => calendar.removeCalendar(id),
      occurrences: async (from, to) => calendar.occurrences(from, to),
      get: async (id) => calendar.get(id),
      save: async (e) => calendar.save(e),
      remove: async (id, occ) => calendar.remove(id, occ),
      importIcs: (cal, text) => calendar.importIcs(cal, text),
      exportIcs: (cal) => calendar.exportIcs(cal),
      refreshSubscription: (id) => calendar.refreshSubscription(id),
      respond: (mid, r, cal) => calendar.respond(mid, r, cal),
      sendInvites: (id, acc) => calendar.sendInvites(id, acc)
    },
    contacts: {
      list: async (s) => contacts.list(s),
      save: async (c) => contacts.save(c),
      remove: async (ids) => contacts.remove(ids),
      importVcf: () => contacts.importVcf(),
      exportVcf: (ids) => contacts.exportVcf(ids),
      importCsv: () => contacts.importCsv(),
      byEmail: async (e) => contacts.byEmail(e)
    },
    tasks: {
      lists: async () => tasks.lists(),
      saveList: async (l) => tasks.saveList(l),
      removeList: async (id) => tasks.removeList(id),
      list: async () => tasks.list(),
      save: async (t) => tasks.save(t),
      remove: async (id) => tasks.remove(id),
      fromMessage: async (id) => tasks.fromMessage(id)
    },
    notes: {
      list: async () => tasks.notes(),
      save: async (n) => tasks.saveNote(n),
      remove: async (id) => tasks.removeNote(id)
    },
    settings: {
      get: async () => config.getSettings(),
      update: async (patch) => {
        const before = config.getSettings();
        const s = config.updateSettings(patch);
        if (patch.launchAtLogin !== undefined || patch.startMinimized !== undefined) applyLoginItem(s);
        if (patch.notifications && before.notifications.badge !== s.notifications.badge) platform().setBadge(s.notifications.badge ? mail.store.unreadInboxCount() : 0);
        emit('settings:changed', s);
        return s;
      },
      saveRules: async (rules) => {
        config.updateSettings({ rules });
        emit('settings:changed', config.getSettings());
      },
      runRules: (fid) => mail.runRules(fid),
      exportAll: async () => {
        const target = await platform().saveDialog({
          title: 'Daten exportieren',
          defaultPath: path.join(os.homedir(), 'Documents', `KS-Mail-Export-${new Date().toISOString().slice(0, 10)}.json`),
          filters: [{ name: 'KS Mail Export', extensions: ['json'] }]
        });
        if (!target) return null;
        const cal = calendar.exportAll();
        const bundle: ExportBundle = {
          app: 'ks-mail',
          version: 1,
          settings: config.getSettings(),
          accounts: config.listAccounts().map((a) => ({ ...a, hasSecret: false })),
          calendars: cal.calendars,
          events: cal.events,
          contacts: contacts.list(),
          taskLists: tasks.lists(),
          tasks: tasks.list(),
          notes: tasks.notes()
        };
        await fs.promises.writeFile(target, JSON.stringify(bundle, null, 2), 'utf8');
        return target;
      },
      importAll: async () => {
        const files = await platform().openDialog({ title: 'Daten importieren', filters: [{ name: 'KS Mail Export', extensions: ['json'] }] });
        if (!files[0]) return false;
        const b = JSON.parse(await fs.promises.readFile(files[0], 'utf8')) as ExportBundle;
        if (b.app !== 'ks-mail') throw new Error('Keine gültige KS-Mail-Exportdatei.');
        config.replaceSettings(b.settings);
        for (const a of b.accounts) if (!config.getAccount(a.id) && a.kind !== 'demo') config.saveAccount(a);
        calendar.importAll({ calendars: b.calendars, events: b.events });
        for (const c of b.contacts) contacts.save(c, true);
        for (const l of b.taskLists) tasks.saveList(l);
        for (const t of b.tasks) tasks.save(t);
        for (const n of b.notes) tasks.saveNote(n);
        for (const a of config.listAccounts()) if (a.enabled) mail.startAccount(a);
        emit('settings:changed', config.getSettings());
        emit('accounts:changed', null);
        emit('contacts:changed', null);
        toast('success', 'Import abgeschlossen. Passwörter müssen neu eingegeben werden.');
        return true;
      }
    },
    app: {
      info: async () => ({ version: platform().version, platform: process.platform, dataDir, secureStorage: platform().secureStorage, electron: platform().electron }),
      search: async (text) => {
        const hits: SearchHit[] = [];
        if (!text.trim()) return hits;
        for (const m of mail.searchAll(text)) hits.push({ kind: 'mail', id: String(m.id), title: m.subject || '(Ohne Betreff)', subtitle: m.from.name || m.from.address, date: m.date });
        for (const e of calendar.searchText(text)) hits.push({ kind: 'event', id: e.id, title: e.title, subtitle: e.location, date: calendar.nextOccurrence(e) });
        for (const c of contacts.list(text).slice(0, 10)) hits.push({ kind: 'contact', id: c.id, title: contactName(c), subtitle: c.emails[0]?.value ?? c.company, date: null });
        const q = text.toLowerCase();
        for (const t of tasks.list().filter((t) => t.title.toLowerCase().includes(q)).slice(0, 10)) hits.push({ kind: 'task', id: t.id, title: t.title, subtitle: t.done ? 'Erledigt' : 'Offen', date: t.due });
        return hits;
      },
      openDataDir: async () => platform().openPath(dataDir),
      clearCache: async () => {
        mail.clearCache();
        toast('success', 'Nachrichten-Cache geleert.');
      },
      openExternal: async (url) => {
        if (!/^(https?:|mailto:|tel:|msteams:|zoommtg:)/i.test(url)) throw new Error('Dieser Link-Typ wird nicht geöffnet.');
        await platform().openExternal(url);
      },
      setBadge: async (n) => platform().setBadge(n),
      newWindow: async (route) => platform().newWindow(route),
      quit: async () => platform().quit()
    }
  };

  mail.start();
  calendar.start();

  return {
    api,
    mail,
    calendar,
    config,
    db,
    shutdown: async () => {
      calendar.stop();
      if (config.getSettings().mail.emptyTrashOnExit) {
        for (const f of mail.folders().filter((f) => f.specialUse === 'trash')) await mail.emptyFolder(f.id).catch(() => undefined);
      }
      await mail.stop();
      db.close();
    }
  };
}

export class RpcError extends Error {}

export async function dispatch(api: Api, method: string, args: unknown[]): Promise<unknown> {
  const [ns, fn] = method.split('.');
  const target = (api as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)[ns];
  if (!target || typeof target[fn] !== 'function') throw new RpcError(`Unbekannte Methode: ${method}`);
  return target[fn](...args);
}
