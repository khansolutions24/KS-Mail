import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Db } from '../store/db';
import { MailStore, folderId, parseSearch, threadKeyFor } from '../mail/store';
import { sanitizeHtml } from '../mail/parse';

function store(): MailStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ksm-store-'));
  return new MailStore(new Db(path.join(dir, 't.db')));
}

describe('mail store', () => {
  it('parses search syntax', () => {
    expect(parseSearch('von:anna betreff:"Q3 Bericht" hat:anhang rest')).toEqual([
      { field: 'from', value: 'anna' },
      { field: 'subject', value: 'Q3 Bericht' },
      { field: 'has', value: 'anhang' },
      { field: 'any', value: 'rest' }
    ]);
  });
  it('builds thread keys from references or subject', () => {
    expect(threadKeyFor({ messageId: '<b>', inReplyTo: '<a>', references: '<root> <a>', subject: 'AW: x' })).toBe('<root>');
    expect(threadKeyFor({ messageId: '<b>', inReplyTo: '', references: '', subject: 'AW: Hallo' })).toBe('s:hallo');
  });
  it('inserts, queries, flags and replaces moved placeholders', () => {
    const s = store();
    const fid = folderId('a', 'INBOX');
    s.upsertFolder({ id: fid, account_id: 'a', path: 'INBOX', name: 'Posteingang', delimiter: '/', parent_path: null, special_use: 'inbox', unread: 0, total: 0, subscribed: 1, selectable: 1 });
    const base = { accountId: 'a', folderId: fid, inReplyTo: '', references: '', to: [], cc: [], size: 10, hasAttachments: false, snippet: 'hallo welt', headers: {} };
    s.insert({ ...base, uid: 1, messageId: '<1>', subject: 'Eins', from: { name: 'Anna', address: 'anna@x.de' }, date: 1000, flags: new Set(['\\Seen']) });
    s.insert({ ...base, uid: 2, messageId: '<2>', subject: 'Zwei', from: { name: 'Bob', address: 'bob@x.de' }, date: 2000, flags: new Set() });
    expect(s.list({ folderId: fid }, []).items.map((m) => m.subject)).toEqual(['Zwei', 'Eins']);
    expect(s.list({ folderId: fid, filter: 'unread' }, []).total).toBe(1);
    expect(s.list({ folderId: fid, search: 'von:anna' }, []).items[0].subject).toBe('Eins');
    expect(s.list({ folderId: 'virtual:inbox' }, ['a']).total).toBe(2);
    expect(s.updateFlags(fid, 2, new Set(['\\Seen', '\\Flagged']))).toBe(true);
    expect(s.list({ folderId: 'virtual:flagged' }, ['a']).total).toBe(1);
    s.recount([fid]);
    expect(s.folders('a')[0]).toMatchObject({ unread: 0, total: 2 });
    // placeholder from an optimistic move is replaced by the real server copy
    const row = s.byUid(fid, 1)!;
    s.moveRow(row.id, fid, s.nextTempUid(fid));
    s.insert({ ...base, uid: 3, messageId: '<1>', subject: 'Eins', from: { name: 'Anna', address: 'anna@x.de' }, date: 1000, flags: new Set() });
    expect(s.uids(fid).sort()).toEqual([2, 3]);
  });
});

describe('sanitizeHtml', () => {
  it('removes scripts, handlers and javascript urls', () => {
    const out = sanitizeHtml('<p onclick="x()">a</p><script>alert(1)</script><iframe src="x"></iframe><a href="javascript:alert(1)">l</a><meta http-equiv="refresh" content="0">');
    expect(out).not.toMatch(/script|onclick|iframe|javascript:|refresh/i);
    expect(out).toMatch(/<p\s*>a<\/p>/);
    expect(sanitizeHtml('<img/onerror=alert(1) src=x>')).not.toMatch(/onerror/);
  });
});

describe('outgoing mail', () => {
  it('removes the Bcc header for SMTP delivery but keeps recipients in the envelope', async () => {
    const { buildMessage } = await import('../mail/send');
    const { defaultAccount } = await import('@shared/defaults');
    const acc = { ...defaultAccount(), email: 'me@x.de', displayName: 'Ich' };
    const m = await buildMessage(
      acc,
      { id: 'd', accountId: acc.id, to: [{ name: 'A', address: 'a@x.de' }], cc: [], bcc: [{ name: 'Geheim', address: 'secret@x.de' }], subject: 'Hallo', html: '<p>x</p>', attachments: [] },
      async () => ({ filename: '', contentType: '', content: Buffer.alloc(0) })
    );
    expect(m.raw.toString()).toMatch(/^Bcc:/m);
    expect(m.withoutBcc.toString()).not.toMatch(/secret@x\.de/);
    expect(m.envelope.to).toContain('secret@x.de');
    expect(m.withoutBcc.toString()).toMatch(/^Subject: Hallo/m);
  });
});
