// Local SQLite database (node:sqlite, no native modules) for cached mail and PIM data.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, path TEXT NOT NULL, name TEXT NOT NULL, delimiter TEXT NOT NULL DEFAULT '/',
    parent_path TEXT, special_use TEXT, unread INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
    subscribed INTEGER NOT NULL DEFAULT 1, selectable INTEGER NOT NULL DEFAULT 1, favorite INTEGER NOT NULL DEFAULT 0,
    uid_validity TEXT, highest_modseq TEXT, synced_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS folders_account ON folders(account_id)`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, folder_id TEXT NOT NULL, uid INTEGER NOT NULL,
    message_id TEXT NOT NULL DEFAULT '', in_reply_to TEXT NOT NULL DEFAULT '', refs TEXT NOT NULL DEFAULT '', thread_key TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '', from_name TEXT NOT NULL DEFAULT '', from_addr TEXT NOT NULL DEFAULT '',
    to_json TEXT NOT NULL DEFAULT '[]', cc_json TEXT NOT NULL DEFAULT '[]', date INTEGER NOT NULL DEFAULT 0, size INTEGER NOT NULL DEFAULT 0,
    seen INTEGER NOT NULL DEFAULT 0, flagged INTEGER NOT NULL DEFAULT 0, answered INTEGER NOT NULL DEFAULT 0, forwarded INTEGER NOT NULL DEFAULT 0,
    draft INTEGER NOT NULL DEFAULT 0, has_attachments INTEGER NOT NULL DEFAULT 0, snippet TEXT NOT NULL DEFAULT '',
    categories TEXT NOT NULL DEFAULT '[]', due_at INTEGER, snoozed_until INTEGER, pinned INTEGER NOT NULL DEFAULT 0,
    headers_json TEXT NOT NULL DEFAULT '{}', is_other INTEGER NOT NULL DEFAULT 0, UNIQUE(folder_id, uid))`,
  `CREATE INDEX IF NOT EXISTS messages_folder_date ON messages(folder_id, date DESC)`,
  `CREATE INDEX IF NOT EXISTS messages_thread ON messages(account_id, thread_key)`,
  `CREATE INDEX IF NOT EXISTS messages_msgid ON messages(message_id)`,
  `CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, draft_json TEXT NOT NULL, send_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued', error TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS local_drafts (id TEXT PRIMARY KEY, draft_json TEXT NOT NULL, updated INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS calendars (id TEXT PRIMARY KEY, json TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL, uid TEXT NOT NULL, start INTEGER NOT NULL,
    end INTEGER NOT NULL, recurring INTEGER NOT NULL DEFAULT 0, until INTEGER, json TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS events_range ON events(start, end)`,
  `CREATE INDEX IF NOT EXISTS events_uid ON events(uid)`,
  `CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, name TEXT NOT NULL, emails TEXT NOT NULL, json TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS task_lists (id TEXT PRIMARY KEY, json TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, json TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, json TEXT NOT NULL)`
];

/** Idempotent schema upgrades for databases created by older versions */
const MIGRATIONS = [`ALTER TABLE messages ADD COLUMN is_other INTEGER NOT NULL DEFAULT 0`];

export class Db {
  readonly raw: DatabaseSync;
  private cache = new Map<string, StatementSync>();

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF;');
    for (const s of SCHEMA) this.raw.exec(s);
    for (const m of MIGRATIONS) {
      try {
        this.raw.exec(m);
      } catch {
        // already applied
      }
    }
  }

  stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  all<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): T[] {
    return this.stmt(sql).all(...params) as T[];
  }

  get<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): T | undefined {
    return this.stmt(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: SqlParam[]): { changes: number; lastInsertRowid: number } {
    const r = this.stmt(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN');
    try {
      const r = fn();
      this.raw.exec('COMMIT');
      return r;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }

  kvGet<T>(key: string, fallback: T): T {
    const row = this.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  kvSet(key: string, value: unknown): void {
    this.run('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
  }

  close(): void {
    this.raw.close();
  }
}

export type SqlParam = string | number | bigint | null | Uint8Array;

export function placeholders(n: number): string {
  return new Array(n).fill('?').join(',');
}
