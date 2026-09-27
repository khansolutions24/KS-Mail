// End-to-end test of the mail backend against a real IMAP server plus an in-process SMTP server.
// Needs an IMAP server with two users (default: Dovecot on 127.0.0.1:10143, test@local.test / other@local.test, password "secret").
// Run: npx tsx --tsconfig tsconfig.node.json scripts/integration.ts

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ImapFlow } from 'imapflow';
import { SMTPServer } from 'smtp-server';
import { setPlatform } from '../src/backend/platform';
import { onEmit } from '../src/backend/events';
import { createBackend } from '../src/backend/api';
import { defaultAccount } from '../src/shared/defaults';
import type { Account, Folder } from '../src/shared/types';
import { VIRTUAL } from '../src/shared/types';

const IMAP_HOST = process.env['IMAP_HOST'] ?? '127.0.0.1';
const IMAP_PORT = Number(process.env['IMAP_PORT'] ?? 10143);
const SMTP_PORT = 10025;
const USER = 'test@local.test';
const OTHER = 'other@local.test';
const PASS = 'secret';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false> | T | null | undefined | false, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout: ${what}`);
    await sleep(200);
  }
}

function imap(user: string): ImapFlow {
  const c = new ImapFlow({ host: IMAP_HOST, port: IMAP_PORT, secure: false, doSTARTTLS: false, auth: { user, pass: PASS }, logger: false });
  c.on('error', () => undefined);
  return c;
}

async function resetMailbox(user: string): Promise<void> {
  const c = imap(user);
  await c.connect();
  for (const l of await c.list()) {
    if (l.path === 'INBOX' || l.specialUse) {
      const lock = await c.getMailboxLock(l.path);
      try {
        if (c.mailbox && c.mailbox.exists) await c.messageDelete('1:*');
      } finally {
        lock.release();
      }
    } else await c.mailboxDelete(l.path).catch(() => undefined);
  }
  await c.logout();
}

function mime(from: string, to: string, subject: string, body: string, extra = ''): string {
  return `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMessage-ID: <${Math.random().toString(36).slice(2)}@test>\r\nDate: ${new Date().toUTCString()}\r\n${extra}MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`;
}

async function deliver(user: string, raw: string | Buffer, flags: string[] = []): Promise<void> {
  const c = imap(user);
  await c.connect();
  await c.append('INBOX', raw, flags);
  await c.logout();
}

async function serverFlags(user: string, folder: string, subject: string): Promise<Set<string> | null> {
  const c = imap(user);
  await c.connect();
  const lock = await c.getMailboxLock(folder);
  try {
    const uids = await c.search({ subject }, { uid: true });
    if (!Array.isArray(uids) || !uids.length) return null;
    const m = await c.fetchOne(String(uids[0]), { flags: true }, { uid: true });
    return m ? (m.flags ?? new Set()) : null;
  } finally {
    lock.release();
    await c.logout();
  }
}

async function serverCount(user: string, folder: string): Promise<number> {
  const c = imap(user);
  await c.connect();
  const s = await c.status(folder, { messages: true });
  await c.logout();
  return s ? (s.messages ?? 0) : -1;
}

async function main(): Promise<void> {
  await resetMailbox(USER);
  await resetMailbox(OTHER);

  // SMTP server that "delivers" by appending to the recipients' INBOX
  const received: string[] = [];
  const smtp = new SMTPServer({
    authOptional: false,
    disabledCommands: ['STARTTLS'],
    onAuth(auth, _s, cb) {
      if (auth.password === PASS) cb(null, { user: auth.username });
      else cb(new Error('bad auth'));
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', async () => {
        const raw = Buffer.concat(chunks);
        received.push(raw.toString('utf8'));
        for (const rcpt of session.envelope.rcptTo) {
          if ([USER, OTHER].includes(rcpt.address)) await deliver(rcpt.address, raw);
        }
        cb();
      });
    }
  });
  await new Promise<void>((r) => smtp.listen(SMTP_PORT, '127.0.0.1', r));

  // pre-existing mail
  for (let i = 1; i <= 5; i++) await deliver(USER, mime('Alice <alice@example.com>', USER, `Hallo ${i}`, `Nachricht Nummer ${i}\nZeile 2 mit Umlauten äöü`), i <= 2 ? ['\\Seen'] : []);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ksmail-it-'));
  const notifications: string[] = [];
  setPlatform({ dataDir, notify: (t, b) => notifications.push(`${t}|${b}`) });
  const events: string[] = [];
  onEmit((ch) => events.push(ch));
  const b = createBackend();
  const { api } = b;

  // ── autoconfig presets
  const ac = await api.accounts.autoConfig('someone@gmx.de');
  assert.equal(ac?.imap.host, 'imap.gmx.net');

  // ── account test with wrong / right password
  const acc: Account = {
    ...defaultAccount(),
    name: 'Test',
    displayName: 'Test Nutzer',
    email: USER,
    imap: { host: IMAP_HOST, port: IMAP_PORT, security: 'none', user: USER, password: PASS },
    smtp: { host: '127.0.0.1', port: SMTP_PORT, security: 'none', user: USER, password: PASS },
    saveSent: true
  };
  const bad = await api.accounts.test({ ...acc, imap: { ...acc.imap, password: 'wrong' }, smtp: { ...acc.smtp, password: 'wrong' } });
  assert.equal(bad.imap.ok, false);
  assert.equal(bad.smtp.ok, false);
  const good = await api.accounts.test(acc);
  assert.equal(good.imap.ok, true, good.imap.message);
  assert.equal(good.smtp.ok, true, good.smtp.message);
  console.log('✓ account test');

  const saved = await api.accounts.save(acc);
  assert.equal(saved.hasSecret, true);
  assert.equal((saved.imap as { password?: string }).password, undefined, 'password must not be returned');
  const secretsFile = fs.readFileSync(path.join(dataDir, 'secrets.json'), 'utf8');
  assert.ok(!secretsFile.includes(PASS) || secretsFile.includes('plain:'), 'secrets file');

  const folders = await waitFor('folders', async () => {
    const f = await api.mail.folders(saved.id);
    return f.length >= 5 ? f : null;
  });
  const by = (s: Folder['specialUse']) => folders.find((f) => f.specialUse === s)!;
  const inbox = by('inbox');
  assert.ok(inbox && by('sent') && by('trash') && by('drafts') && by('junk'));
  const page = await waitFor('inbox messages', async () => {
    const p = await api.mail.list({ folderId: inbox.id });
    return p.total === 5 ? p : null;
  });
  assert.equal(page.items[0].subject, 'Hallo 5', 'newest first');
  assert.ok(page.items[0].snippet.includes('Nachricht Nummer 5'), `snippet: ${page.items[0].snippet}`);
  assert.equal(page.items.filter((m) => !m.seen).length, 3);
  await waitFor('inbox unread count', async () => (await api.mail.folders(saved.id)).find((f) => f.id === inbox.id)?.unread === 3);
  console.log('✓ initial sync, snippets, counts');

  // ── body
  const body = await api.mail.body(page.items[0].id);
  assert.ok(body.text.includes('Umlauten äöü'));
  console.log('✓ body');

  // ── flags round trip
  await api.mail.setFlags([page.items[0].id], { seen: true, flagged: true });
  await waitFor('server flags', async () => {
    const f = await serverFlags(USER, 'INBOX', 'Hallo 5');
    return f?.has('\\Seen') && f.has('\\Flagged');
  });
  const unified = await api.mail.list({ folderId: VIRTUAL.flagged });
  assert.equal(unified.total, 1);
  console.log('✓ flags');

  // ── external change is picked up (flags changed by another client)
  {
    const c = imap(USER);
    await c.connect();
    const lock = await c.getMailboxLock('INBOX');
    const uids = (await c.search({ subject: 'Hallo 4' }, { uid: true })) as number[];
    await c.messageFlagsAdd(uids.join(','), ['\\Flagged'], { uid: true });
    lock.release();
    await c.logout();
    await api.mail.sync(saved.id, inbox.id);
    const p = await api.mail.list({ folderId: inbox.id, filter: 'flagged' });
    assert.equal(p.total, 2);
  }
  console.log('✓ external flag change');

  // ── push (IDLE): new mail arrives and triggers a notification
  await sleep(2500);
  notifications.length = 0;
  await deliver(USER, mime('Bob <bob@example.com>', USER, 'Neu per IDLE', 'Push funktioniert'));
  await waitFor('idle push', async () => (await api.mail.list({ folderId: inbox.id })).items.some((m) => m.subject === 'Neu per IDLE'), 20000);
  await waitFor('notification', () => notifications.some((n) => n.startsWith('Bob|')));
  console.log('✓ IDLE push + notification');

  // ── rules on new mail: subject contains "Rechnung" → move to new folder "Rechnungen" + category
  await api.mail.createFolder(saved.id, null, 'Rechnungen');
  const rechnungen = await waitFor('folder created', async () => (await api.mail.folders(saved.id)).find((f) => f.path === 'Rechnungen'));
  await api.settings.saveRules([
    {
      id: 'r1',
      name: 'Rechnungen',
      enabled: true,
      accountId: null,
      match: 'all',
      conditions: [{ field: 'subject', op: 'contains', value: 'rechnung' }],
      actions: [{ type: 'category', category: 'Rot' }, { type: 'move', folderPath: 'Rechnungen' }],
      stopProcessing: true
    }
  ]);
  await deliver(USER, mime('Shop <shop@example.com>', USER, 'Ihre Rechnung 123', 'Betrag: 10 €'));
  await api.mail.sync(saved.id, inbox.id);
  const moved = await waitFor('rule moved', async () => {
    const p = await api.mail.list({ folderId: rechnungen.id });
    return p.items.find((m) => m.subject === 'Ihre Rechnung 123' && m.uid > 0);
  });
  assert.deepEqual(moved.categories, ['Rot']);
  await waitFor('server has message in Rechnungen', async () => (await serverCount(USER, 'Rechnungen')) === 1);
  console.log('✓ rules (category + move)');

  // ── move / delete / archive
  const cur = (await api.mail.list({ folderId: inbox.id })).items;
  const h1 = cur.find((m) => m.subject === 'Hallo 1')!;
  const h2 = cur.find((m) => m.subject === 'Hallo 2')!;
  const h3 = cur.find((m) => m.subject === 'Hallo 3')!;
  await api.mail.move([h1.id], rechnungen.id);
  await waitFor('moved on server', async () => (await serverCount(USER, 'Rechnungen')) === 2);
  const movedRow = await api.mail.get(h1.id);
  assert.ok(movedRow && movedRow.folderId === rechnungen.id && movedRow.uid > 0, 'row keeps id and gets real uid');
  await api.mail.remove([h2.id]);
  await waitFor('in trash', async () => (await serverCount(USER, 'Trash')) === 1);
  const trash = by('trash');
  const inTrash = await api.mail.list({ folderId: trash.id });
  assert.equal(inTrash.total, 1);
  await api.mail.remove([inTrash.items[0].id]);
  await waitFor('expunged from trash', async () => (await serverCount(USER, 'Trash')) === 0);
  await api.mail.archive([h3.id]);
  await waitFor('archive created', async () => (await serverCount(USER, 'Archive')) === 1);
  const archive = (await api.mail.folders(saved.id)).find((f) => f.specialUse === 'archive');
  assert.ok(archive, 'archive folder marked');
  console.log('✓ move / delete / trash / archive');

  // ── rename + delete folder
  await api.mail.renameFolder(rechnungen.id, 'Belege');
  const belege = await waitFor('renamed', async () => (await api.mail.folders(saved.id)).find((f) => f.path === 'Belege'));
  await waitFor('renamed messages', async () => (await api.mail.list({ folderId: belege.id })).total === 2);
  await api.mail.createFolder(saved.id, 'Belege', '2026');
  const sub = await waitFor('subfolder', async () => (await api.mail.folders(saved.id)).find((f) => f.path === 'Belege/2026'));
  assert.equal(sub.parentPath, 'Belege');
  await api.mail.deleteFolder(sub.id);
  await waitFor('deleted', async () => !(await api.mail.folders(saved.id)).some((f) => f.path === 'Belege/2026'));
  console.log('✓ create / rename / delete folders');

  // ── search (local + server)
  const local = await api.mail.list({ folderId: inbox.id, search: 'von:bob' });
  assert.equal(local.total, 1);
  const remote = await api.mail.serverSearch(inbox.id, 'Push funktioniert');
  assert.equal(remote.total, 1);
  console.log('✓ search');

  // ── reply + send (undo delay 0) → other user receives, copy in Sent, \Answered set
  await api.settings.update({ mail: { ...(await api.settings.get()).mail, undoSendSeconds: 0 } });
  const bob = (await api.mail.list({ folderId: inbox.id, search: 'Neu per IDLE' })).items[0];
  const reply = await api.compose.prepare('reply', bob.id);
  assert.equal(reply.subject, 'AW: Neu per IDLE');
  assert.equal(reply.to[0].address, 'bob@example.com');
  reply.to = [{ name: 'Other', address: OTHER }];
  reply.html = '<p>Antwort <b>fett</b></p>' + reply.html;
  reply.attachments = [{ id: 'a1', filename: 'notiz.txt', contentType: 'text/plain', size: 5, dataBase64: Buffer.from('hallo').toString('base64') }];
  await api.compose.send(reply);
  await waitFor('delivered to other', async () => (await serverCount(OTHER, 'INBOX')) === 1);
  await waitFor('copy in sent', async () => (await serverCount(USER, 'Sent')) === 1);
  await waitFor('answered flag', async () => (await serverFlags(USER, 'INBOX', 'Neu per IDLE'))?.has('\\Answered'));
  const sentMail = received.find((r) => r.includes('AW: Neu per IDLE'))!;
  assert.ok(/In-Reply-To: <.+>/.test(sentMail), 'In-Reply-To header');
  assert.ok(sentMail.includes('notiz.txt'), 'attachment');
  assert.equal((await api.compose.outbox()).length, 0);
  console.log('✓ reply + send + sent copy + \\Answered');

  // ── forward keeps attachments of the original
  const sentFolder = by('sent');
  await api.mail.sync(saved.id, sentFolder.id);
  const sentItem = await waitFor('sent synced', async () => (await api.mail.list({ folderId: sentFolder.id })).items[0]);
  const fwd = await api.compose.prepare('forward', sentItem.id);
  assert.equal(fwd.attachments.length, 1);
  assert.equal(fwd.subject, 'WG: AW: Neu per IDLE');
  fwd.to = [{ name: '', address: OTHER }];
  await api.compose.send(fwd);
  await waitFor('forward delivered', async () => (await serverCount(OTHER, 'INBOX')) === 2);
  assert.ok(received.some((r) => r.includes('WG: AW: Neu per IDLE') && r.includes('notiz.txt')));
  console.log('✓ forward with attachments');

  // ── undo send
  await api.settings.update({ mail: { ...(await api.settings.get()).mail, undoSendSeconds: 10 } });
  await api.compose.send({ id: 'undo', accountId: saved.id, to: [{ name: '', address: OTHER }], cc: [], bcc: [], subject: 'Nicht senden', html: 'x', attachments: [] });
  const ob = await api.compose.outbox();
  assert.equal(ob.length, 1);
  const back = await api.compose.cancelOutbox(ob[0].id);
  assert.equal(back?.subject, 'Nicht senden');
  await sleep(1500);
  assert.ok(!received.some((r) => r.includes('Nicht senden')));
  console.log('✓ undo send');

  // ── drafts: save twice (old server copy replaced), then discard
  const draft = await api.compose.saveDraft({ id: 'd1', accountId: saved.id, to: [{ name: '', address: OTHER }], cc: [], bcc: [], subject: 'Entwurf', html: '<p>eins</p>', attachments: [] });
  assert.ok(draft.serverDraftMessageId);
  const draft2 = await api.compose.saveDraft({ ...draft, html: '<p>zwei</p>' });
  assert.notEqual(draft2.serverDraftMessageId, draft.serverDraftMessageId);
  await waitFor('one draft on server', async () => (await serverCount(USER, 'Drafts')) === 1);
  const edit = await api.compose.prepare('edit', draft2.serverDraftMessageId!);
  assert.ok(edit.html.includes('zwei'));
  await api.compose.discardDraft(draft2);
  await waitFor('draft removed', async () => (await serverCount(USER, 'Drafts')) === 0);
  console.log('✓ drafts');

  // ── mark folder read + unread counter
  await deliver(USER, mime('Carol <carol@example.com>', USER, 'Ungelesen A', 'a'));
  await deliver(USER, mime('Carol <carol@example.com>', USER, 'Ungelesen B', 'b'));
  await api.mail.sync(saved.id, inbox.id);
  await waitFor('unread arrived', async () => (await api.mail.list({ folderId: inbox.id, filter: 'unread' })).total >= 2);
  await api.mail.markFolderRead(inbox.id);
  await waitFor('all read on server', async () => {
    const c = imap(USER);
    await c.connect();
    const s = await c.status('INBOX', { unseen: true });
    await c.logout();
    return s && s.unseen === 0;
  });
  console.log('✓ mark folder read');

  // ── contacts collected from sent mail + suggestions
  const sug = await api.compose.suggest('other');
  assert.ok(sug.some((s) => s.address === OTHER));
  console.log('✓ collected recipients / suggestions');

  // ── invitation respond
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:REQUEST', 'BEGIN:VEVENT', 'UID:it-1@test', 'DTSTAMP:20260101T000000Z',
    'DTSTART:20261001T080000Z', 'DTEND:20261001T090000Z', 'SUMMARY:Planung', 'ORGANIZER;CN=Other:mailto:' + OTHER,
    'ATTENDEE;CN=Test;PARTSTAT=NEEDS-ACTION:mailto:' + USER, 'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
  const inviteRaw = `From: Other <${OTHER}>\r\nTo: ${USER}\r\nSubject: Einladung: Planung\r\nMessage-ID: <inv1@test>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=b1\r\n\r\n--b1\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nBitte zusagen\r\n--b1\r\nContent-Type: text/calendar; method=REQUEST; charset=utf-8\r\n\r\n${ics}\r\n--b1--\r\n`;
  await deliver(USER, inviteRaw);
  await api.mail.sync(saved.id, inbox.id);
  const inv = await waitFor('invite', async () => (await api.mail.list({ folderId: inbox.id, search: 'Einladung' })).items[0]);
  const invBody = await api.mail.body(inv.id);
  assert.equal(invBody.invite?.[0].title, 'Planung');
  await api.calendar.respond(inv.id, 'accepted', 'default');
  const occ = await api.calendar.occurrences(Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 2));
  assert.equal(occ.length, 1);
  assert.equal(occ[0].event.attendees.find((a) => a.email === USER)?.status, 'accepted');
  await waitFor('reply delivered', () => received.some((r) => r.includes('METHOD:REPLY') && r.includes('PARTSTAT=ACCEPTED')));
  console.log('✓ invitation accept → calendar + iMIP reply');

  // ── second account + cross-account move
  const acc2: Account = { ...acc, id: 'acc2', email: OTHER, name: 'Other', imap: { ...acc.imap, user: OTHER, password: PASS }, smtp: { ...acc.smtp, user: OTHER, password: PASS } };
  const saved2 = await api.accounts.save(acc2);
  const inbox2 = await waitFor('inbox2', async () => (await api.mail.folders(saved2.id)).find((f) => f.specialUse === 'inbox'));
  await waitFor('inbox2 synced', async () => (await api.mail.list({ folderId: inbox2.id })).total === 3);
  const unifiedInbox = await api.mail.list({ folderId: VIRTUAL.unifiedInbox });
  assert.ok(unifiedInbox.items.some((m) => m.accountId === saved2.id) && unifiedInbox.items.some((m) => m.accountId === saved.id));
  const carol = (await api.mail.list({ folderId: inbox.id, search: 'Ungelesen A' })).items[0];
  await api.mail.move([carol.id], inbox2.id);
  await waitFor('cross-account move', async () => (await serverCount(OTHER, 'INBOX')) === 4);
  await waitFor('removed from source', async () => (await serverCount(USER, 'INBOX')) === (await api.mail.list({ folderId: inbox.id })).total);
  console.log('✓ second account, unified inbox, cross-account move');

  // ── remove account cleans up
  await api.accounts.remove(saved2.id);
  assert.equal((await api.mail.folders(saved2.id)).length, 0);
  console.log('✓ remove account');

  assert.ok(events.includes('mail:changed') && events.includes('sync:state'));
  await b.shutdown();
  smtp.close();
  console.log('\nALL INTEGRATION TESTS PASSED');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
