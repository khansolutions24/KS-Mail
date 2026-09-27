// Database access for folders and cached message headers.

import type { Address, Folder, MessageHeader, MessagePage, MessageQuery, SpecialUse } from '@shared/types';
import { VIRTUAL } from '@shared/types';
import { normalizeSubject } from '@shared/util';
import { placeholders, type Db, type SqlParam } from '../store/db';

export interface FolderRow {
  id: string;
  account_id: string;
  path: string;
  name: string;
  delimiter: string;
  parent_path: string | null;
  special_use: string | null;
  unread: number;
  total: number;
  subscribed: number;
  selectable: number;
  favorite: number;
  uid_validity: string | null;
  highest_modseq: string | null;
  synced_at: number | null;
}

export interface MessageRow {
  id: number;
  account_id: string;
  folder_id: string;
  uid: number;
  message_id: string;
  in_reply_to: string;
  refs: string;
  thread_key: string;
  subject: string;
  from_name: string;
  from_addr: string;
  to_json: string;
  cc_json: string;
  date: number;
  size: number;
  seen: number;
  flagged: number;
  answered: number;
  forwarded: number;
  draft: number;
  has_attachments: number;
  snippet: string;
  categories: string;
  due_at: number | null;
  snoozed_until: number | null;
  pinned: number;
  headers_json: string;
}

export function folderId(accountId: string, path: string): string {
  return `${accountId}:${path}`;
}

export function toFolder(r: FolderRow): Folder {
  return {
    id: r.id,
    accountId: r.account_id,
    path: r.path,
    name: r.name,
    delimiter: r.delimiter,
    parentPath: r.parent_path,
    specialUse: (r.special_use as SpecialUse) ?? null,
    unread: r.unread,
    total: r.total,
    subscribed: !!r.subscribed,
    selectable: !!r.selectable,
    favorite: !!r.favorite
  };
}

function parseJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function toHeader(r: MessageRow): MessageHeader {
  return {
    id: r.id,
    accountId: r.account_id,
    folderId: r.folder_id,
    uid: r.uid,
    messageId: r.message_id,
    inReplyTo: r.in_reply_to,
    threadKey: r.thread_key,
    subject: r.subject,
    from: { name: r.from_name, address: r.from_addr },
    to: parseJson<Address[]>(r.to_json, []),
    cc: parseJson<Address[]>(r.cc_json, []),
    date: r.date,
    size: r.size,
    seen: !!r.seen,
    flagged: !!r.flagged,
    answered: !!r.answered,
    forwarded: !!r.forwarded,
    draft: !!r.draft,
    hasAttachments: !!r.has_attachments,
    snippet: r.snippet,
    categories: parseJson<string[]>(r.categories, []),
    dueAt: r.due_at,
    snoozedUntil: r.snoozed_until,
    pinned: !!r.pinned
  };
}

export interface NewMessage {
  accountId: string;
  folderId: string;
  uid: number;
  messageId: string;
  inReplyTo: string;
  references: string;
  subject: string;
  from: Address;
  to: Address[];
  cc: Address[];
  date: number;
  size: number;
  flags: Set<string>;
  hasAttachments: boolean;
  snippet: string;
  headers: Record<string, string>;
}

/** Thread key: first Message-ID of the reference chain, else the normalised subject */
export function threadKeyFor(m: { messageId: string; inReplyTo: string; references: string; subject: string }): string {
  const first = m.references.trim().split(/\s+/)[0] || m.inReplyTo.trim();
  if (first) return first;
  const norm = normalizeSubject(m.subject);
  return norm ? `s:${norm}` : m.messageId;
}

export class MailStore {
  constructor(private db: Db) {}

  folders(accountId?: string): Folder[] {
    const rows = accountId
      ? this.db.all<FolderRow>('SELECT * FROM folders WHERE account_id = ? ORDER BY path', accountId)
      : this.db.all<FolderRow>('SELECT * FROM folders ORDER BY account_id, path');
    return rows.map(toFolder);
  }

  folderRow(id: string): FolderRow | undefined {
    return this.db.get<FolderRow>('SELECT * FROM folders WHERE id = ?', id);
  }

  folderBySpecial(accountId: string, special: SpecialUse): FolderRow | undefined {
    return this.db.get<FolderRow>('SELECT * FROM folders WHERE account_id = ? AND special_use = ? ORDER BY length(path) LIMIT 1', accountId, special);
  }

  upsertFolder(f: Omit<FolderRow, 'uid_validity' | 'highest_modseq' | 'synced_at' | 'favorite'>): void {
    this.db.run(
      `INSERT INTO folders(id, account_id, path, name, delimiter, parent_path, special_use, unread, total, subscribed, selectable)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, delimiter=excluded.delimiter, parent_path=excluded.parent_path,
         special_use=excluded.special_use, unread=excluded.unread, total=excluded.total, subscribed=excluded.subscribed, selectable=excluded.selectable`,
      f.id,
      f.account_id,
      f.path,
      f.name,
      f.delimiter,
      f.parent_path,
      f.special_use,
      f.unread,
      f.total,
      f.subscribed,
      f.selectable
    );
  }

  removeFolder(id: string): void {
    this.db.run('DELETE FROM messages WHERE folder_id = ?', id);
    this.db.run('DELETE FROM folders WHERE id = ?', id);
  }

  setFolderSync(id: string, uidValidity: string, modseq: string | null): void {
    this.db.run('UPDATE folders SET uid_validity = ?, highest_modseq = ?, synced_at = ? WHERE id = ?', uidValidity, modseq, Date.now(), id);
  }

  setFolderCounts(id: string, unread: number, total: number): void {
    this.db.run('UPDATE folders SET unread = ?, total = ? WHERE id = ?', unread, total, id);
  }

  /** Recomputes unread/total from the local cache (demo account and folders cached completely) */
  recount(folderIds: string[]): void {
    for (const id of new Set(folderIds)) {
      const r = this.db.get<{ u: number; t: number }>('SELECT COALESCE(SUM(seen = 0), 0) AS u, COUNT(*) AS t FROM messages WHERE folder_id = ?', id);
      if (r) this.db.run('UPDATE folders SET unread = ?, total = ? WHERE id = ?', r.u, r.t, id);
    }
  }

  adjustUnread(folderId: string, delta: number): void {
    this.db.run('UPDATE folders SET unread = MAX(0, unread + ?) WHERE id = ?', delta, folderId);
  }

  adjustTotal(folderId: string, delta: number): void {
    this.db.run('UPDATE folders SET total = MAX(0, total + ?) WHERE id = ?', delta, folderId);
  }

  setFavorite(id: string, fav: boolean): void {
    this.db.run('UPDATE folders SET favorite = ? WHERE id = ?', fav ? 1 : 0, id);
  }

  clearFolderMessages(id: string): void {
    this.db.run('DELETE FROM messages WHERE folder_id = ?', id);
  }

  maxUid(folderId: string): number {
    return this.db.get<{ m: number | null }>('SELECT MAX(uid) AS m FROM messages WHERE folder_id = ?', folderId)?.m ?? 0;
  }

  minUid(folderId: string): number {
    return this.db.get<{ m: number | null }>('SELECT MIN(uid) AS m FROM messages WHERE folder_id = ?', folderId)?.m ?? 0;
  }

  uids(folderId: string): number[] {
    return this.db.all<{ uid: number }>('SELECT uid FROM messages WHERE folder_id = ?', folderId).map((r) => r.uid);
  }

  insert(m: NewMessage): number {
    const f = m.flags;
    // replace a locally moved placeholder (negative uid) of the same message
    if (m.messageId) this.db.run('DELETE FROM messages WHERE folder_id = ? AND uid < 0 AND message_id = ?', m.folderId, m.messageId);
    const r = this.db.run(
      `INSERT INTO messages(account_id, folder_id, uid, message_id, in_reply_to, refs, thread_key, subject, from_name, from_addr, to_json, cc_json,
         date, size, seen, flagged, answered, forwarded, draft, has_attachments, snippet, headers_json)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(folder_id, uid) DO UPDATE SET seen=excluded.seen, flagged=excluded.flagged, answered=excluded.answered, forwarded=excluded.forwarded`,
      m.accountId,
      m.folderId,
      m.uid,
      m.messageId,
      m.inReplyTo,
      m.references,
      threadKeyFor(m),
      m.subject,
      m.from.name,
      m.from.address,
      JSON.stringify(m.to),
      JSON.stringify(m.cc),
      m.date,
      m.size,
      f.has('\\Seen') ? 1 : 0,
      f.has('\\Flagged') ? 1 : 0,
      f.has('\\Answered') ? 1 : 0,
      f.has('$Forwarded') ? 1 : 0,
      f.has('\\Draft') ? 1 : 0,
      m.hasAttachments ? 1 : 0,
      m.snippet,
      JSON.stringify(m.headers)
    );
    return r.lastInsertRowid;
  }

  updateFlags(folderId: string, uid: number, flags: Set<string>): boolean {
    const r = this.db.run(
      'UPDATE messages SET seen = ?, flagged = ?, answered = ?, forwarded = ?, draft = ? WHERE folder_id = ? AND uid = ? AND (seen != ? OR flagged != ? OR answered != ? OR forwarded != ?)',
      flags.has('\\Seen') ? 1 : 0,
      flags.has('\\Flagged') ? 1 : 0,
      flags.has('\\Answered') ? 1 : 0,
      flags.has('$Forwarded') ? 1 : 0,
      flags.has('\\Draft') ? 1 : 0,
      folderId,
      uid,
      flags.has('\\Seen') ? 1 : 0,
      flags.has('\\Flagged') ? 1 : 0,
      flags.has('\\Answered') ? 1 : 0,
      flags.has('$Forwarded') ? 1 : 0
    );
    return r.changes > 0;
  }

  setSnippet(id: number, snippet: string): void {
    this.db.run('UPDATE messages SET snippet = ? WHERE id = ?', snippet, id);
  }

  deleteUids(folderId: string, uids: number[]): number {
    let n = 0;
    for (let i = 0; i < uids.length; i += 500) {
      const chunk = uids.slice(i, i + 500);
      n += this.db.run(`DELETE FROM messages WHERE folder_id = ? AND uid IN (${placeholders(chunk.length)})`, folderId, ...chunk).changes;
    }
    return n;
  }

  byId(id: number): MessageRow | undefined {
    return this.db.get<MessageRow>('SELECT * FROM messages WHERE id = ?', id);
  }

  byIds(ids: number[]): MessageRow[] {
    if (!ids.length) return [];
    return this.db.all<MessageRow>(`SELECT * FROM messages WHERE id IN (${placeholders(ids.length)})`, ...ids);
  }

  byUid(folderId: string, uid: number): MessageRow | undefined {
    return this.db.get<MessageRow>('SELECT * FROM messages WHERE folder_id = ? AND uid = ?', folderId, uid);
  }

  setLocal(ids: number[], col: 'seen' | 'flagged' | 'pinned' | 'answered' | 'forwarded', value: boolean): void {
    if (!ids.length) return;
    this.db.run(`UPDATE messages SET ${col} = ? WHERE id IN (${placeholders(ids.length)})`, value ? 1 : 0, ...ids);
  }

  setColumn(ids: number[], col: 'due_at' | 'snoozed_until' | 'categories', value: SqlParam): void {
    if (!ids.length) return;
    this.db.run(`UPDATE messages SET ${col} = ? WHERE id IN (${placeholders(ids.length)})`, value, ...ids);
  }

  moveRow(id: number, folderId: string, uid: number): void {
    this.db.run('DELETE FROM messages WHERE folder_id = ? AND uid = ?', folderId, uid);
    this.db.run('UPDATE messages SET folder_id = ?, uid = ? WHERE id = ?', folderId, uid, id);
  }

  deleteIds(ids: number[]): void {
    if (!ids.length) return;
    this.db.run(`DELETE FROM messages WHERE id IN (${placeholders(ids.length)})`, ...ids);
  }

  /** Temporary negative uid for rows moved locally before the server confirmed the new uid */
  nextTempUid(folderId: string): number {
    const m = this.db.get<{ m: number | null }>('SELECT MIN(uid) AS m FROM messages WHERE folder_id = ?', folderId)?.m ?? 0;
    return Math.min(0, m) - 1;
  }

  list(q: MessageQuery, accountIds: string[]): MessagePage {
    const where: string[] = [];
    const params: SqlParam[] = [];
    const now = Date.now();
    switch (q.folderId) {
      case VIRTUAL.unifiedInbox:
        where.push(`folder_id IN (SELECT id FROM folders WHERE special_use = 'inbox')`);
        break;
      case VIRTUAL.unread:
        where.push(`seen = 0 AND folder_id IN (SELECT id FROM folders WHERE special_use IS NULL OR special_use IN ('inbox','archive'))`);
        break;
      case VIRTUAL.flagged:
        where.push(`flagged = 1 AND folder_id NOT IN (SELECT id FROM folders WHERE special_use IN ('trash','junk','all','flagged'))`);
        break;
      case VIRTUAL.snoozed:
        where.push('snoozed_until IS NOT NULL AND snoozed_until > ?');
        params.push(now);
        break;
      default:
        where.push('folder_id = ?');
        params.push(q.folderId);
    }
    if (q.folderId !== VIRTUAL.snoozed) {
      where.push('(snoozed_until IS NULL OR snoozed_until <= ?)');
      params.push(now);
    }
    if (accountIds.length) {
      where.push(`account_id IN (${placeholders(accountIds.length)})`);
      params.push(...accountIds);
    }
    switch (q.filter) {
      case 'unread':
        where.push('seen = 0');
        break;
      case 'flagged':
        where.push('flagged = 1');
        break;
      case 'attachments':
        where.push('has_attachments = 1');
        break;
    }
    if (q.category) {
      where.push(`categories LIKE ?`);
      params.push(`%"${q.category.replace(/[%_"]/g, '')}"%`);
    }
    if (q.search?.trim()) {
      for (const term of parseSearch(q.search)) {
        const like = `%${term.value.replace(/[%_]/g, (m) => '\\' + m)}%`;
        switch (term.field) {
          case 'from':
            where.push(`(from_addr LIKE ? ESCAPE '\\' OR from_name LIKE ? ESCAPE '\\')`);
            params.push(like, like);
            break;
          case 'to':
            where.push(`(to_json LIKE ? ESCAPE '\\' OR cc_json LIKE ? ESCAPE '\\')`);
            params.push(like, like);
            break;
          case 'subject':
            where.push(`subject LIKE ? ESCAPE '\\'`);
            params.push(like);
            break;
          case 'has':
            if (term.value === 'attachment' || term.value === 'anhang') where.push('has_attachments = 1');
            break;
          case 'is':
            if (term.value === 'unread' || term.value === 'ungelesen') where.push('seen = 0');
            if (term.value === 'flagged' || term.value === 'markiert') where.push('flagged = 1');
            if (term.value === 'read' || term.value === 'gelesen') where.push('seen = 1');
            break;
          default:
            where.push(`(subject LIKE ? ESCAPE '\\' OR from_addr LIKE ? ESCAPE '\\' OR from_name LIKE ? ESCAPE '\\' OR snippet LIKE ? ESCAPE '\\' OR to_json LIKE ? ESCAPE '\\')`);
            params.push(like, like, like, like, like);
        }
      }
    }
    const sortCol = { date: 'date', from: 'lower(from_name || from_addr)', subject: 'lower(subject)', size: 'size', flagged: 'flagged' }[q.sort ?? 'date'];
    const dir = q.desc === false ? 'ASC' : 'DESC';
    const w = where.join(' AND ');
    const total = this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM messages WHERE ${w}`, ...params)?.n ?? 0;
    const rows = this.db.all<MessageRow>(
      `SELECT * FROM messages WHERE ${w} ORDER BY pinned DESC, ${sortCol} ${dir}, date DESC, id DESC LIMIT ? OFFSET ?`,
      ...params,
      q.limit ?? 200,
      q.offset ?? 0
    );
    return { total, items: rows.map(toHeader) };
  }

  thread(row: MessageRow): MessageHeader[] {
    const rows = this.db.all<MessageRow>(
      `SELECT * FROM messages WHERE account_id = ? AND (thread_key = ? OR message_id = ? OR thread_key = ?)
       AND folder_id NOT IN (SELECT id FROM folders WHERE special_use IN ('trash','junk','all','flagged')) ORDER BY date`,
      row.account_id,
      row.thread_key,
      row.thread_key,
      row.message_id
    );
    const seen = new Set<string>();
    return rows
      .filter((r) => {
        const k = r.message_id || String(r.id);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map(toHeader);
  }

  recipients(text: string, limit: number): Address[] {
    const like = `%${text.replace(/[%_]/g, '')}%`;
    const rows = this.db.all<{ name: string; addr: string; n: number }>(
      `SELECT from_name AS name, from_addr AS addr, COUNT(*) AS n FROM messages WHERE from_addr LIKE ? OR from_name LIKE ? GROUP BY lower(from_addr) ORDER BY n DESC LIMIT ?`,
      like,
      like,
      limit
    );
    return rows.map((r) => ({ name: r.name, address: r.addr }));
  }

  searchAll(text: string, limit: number): MessageHeader[] {
    const like = `%${text.replace(/[%_]/g, '')}%`;
    return this.db
      .all<MessageRow>(
        `SELECT * FROM messages WHERE (subject LIKE ? OR from_name LIKE ? OR from_addr LIKE ? OR snippet LIKE ?)
         AND folder_id NOT IN (SELECT id FROM folders WHERE special_use IN ('trash','junk','all')) ORDER BY date DESC LIMIT ?`,
        like,
        like,
        like,
        like,
        limit
      )
      .map(toHeader);
  }

  dueSnoozes(now: number): MessageRow[] {
    return this.db.all<MessageRow>('SELECT * FROM messages WHERE snoozed_until IS NOT NULL AND snoozed_until <= ?', now);
  }

  unreadInboxCount(): number {
    return this.db.get<{ n: number }>(`SELECT COALESCE(SUM(unread), 0) AS n FROM folders WHERE special_use = 'inbox'`)?.n ?? 0;
  }

  deleteAccount(accountId: string): void {
    this.db.run('DELETE FROM messages WHERE account_id = ?', accountId);
    this.db.run('DELETE FROM folders WHERE account_id = ?', accountId);
  }
}

export interface SearchTerm {
  field: 'any' | 'from' | 'to' | 'subject' | 'has' | 'is';
  value: string;
}

/** Parses `from:anna subject:"Q3 report" has:attachment rest` */
export function parseSearch(input: string): SearchTerm[] {
  const out: SearchTerm[] = [];
  const re = /(?:(von|from|an|to|betreff|subject|has|hat|is|ist):)?("([^"]*)"|\S+)/gi;
  const map: Record<string, SearchTerm['field']> = { von: 'from', from: 'from', an: 'to', to: 'to', betreff: 'subject', subject: 'subject', has: 'has', hat: 'has', is: 'is', ist: 'is' };
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    const value = (m[3] ?? m[2]).trim();
    if (!value) continue;
    out.push({ field: m[1] ? map[m[1].toLowerCase()] : 'any', value: m[1] && ['has', 'is'].includes(map[m[1].toLowerCase()]) ? value.toLowerCase() : value });
  }
  return out;
}
