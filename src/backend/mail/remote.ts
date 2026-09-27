// The operations the mail service needs from a mail server. Implemented by ImapAccount and DemoRemote.

import type { Account } from '@shared/types';
import type { SyncResult } from './imap';

export interface Remote {
  account: Account;
  onPush: (path: string) => void;
  onFlags: (path: string, uid: number, flags: Set<string>) => void;
  onDisconnect: (err: Error | null) => void;
  syncFolders(): Promise<string[]>;
  syncFolder(path: string, limit: number): Promise<SyncResult>;
  loadOlder(path: string, count: number): Promise<number>;
  fetchSource(path: string, uid: number): Promise<Buffer>;
  setFlags(path: string, uids: number[], add: string[], remove: string[]): Promise<void>;
  move(path: string, uids: number[], target: string): Promise<Map<number, number> | null>;
  copy(path: string, uids: number[], target: string): Promise<void>;
  expunge(path: string, uids: number[] | 'all'): Promise<void>;
  append(path: string, raw: Buffer, flags: string[]): Promise<number | null>;
  createFolder(path: string): Promise<void>;
  renameFolder(path: string, newPath: string): Promise<void>;
  deleteFolder(path: string): Promise<void>;
  search(path: string, text: string): Promise<number[]>;
  ensureCached(path: string, uids: number[]): Promise<void>;
  idle(): Promise<void>;
  close(): Promise<void>;
}
