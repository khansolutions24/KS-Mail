// RPC contract between renderer and backend. Calls are `namespace.method(...args)`.

import type {
  Account,
  AppInfo,
  Calendar,
  CalendarEvent,
  Contact,
  Draft,
  EventOccurrence,
  Folder,
  MessageBody,
  MessageHeader,
  MessagePage,
  MessageQuery,
  Note,
  Notification,
  OAuthProvider,
  OutboxItem,
  Rule,
  RuleAction,
  SearchHit,
  Settings,
  SyncState,
  Task,
  TaskList
} from './types';

export const IPC_INVOKE = 'ksmail:invoke';
export const IPC_EVENT = 'ksmail:event';

export interface AccountTestResult {
  imap: { ok: boolean; message: string };
  smtp: { ok: boolean; message: string };
}

export interface AutoConfigResult {
  imap: { host: string; port: number; security: 'tls' | 'starttls' | 'none' };
  smtp: { host: string; port: number; security: 'tls' | 'starttls' | 'none' };
  oauthProvider?: OAuthProvider;
  source: string;
}

export interface AccountsApi {
  list(): Promise<Account[]>;
  save(account: Account): Promise<Account>;
  remove(id: string): Promise<void>;
  test(account: Account): Promise<AccountTestResult>;
  autoConfig(email: string): Promise<AutoConfigResult | null>;
  /** Opens the provider login in the system browser and stores the refresh token */
  oauthLogin(accountId: string, provider: OAuthProvider, email: string): Promise<void>;
  reorder(ids: string[]): Promise<void>;
  addDemo(): Promise<Account>;
}

export interface MailApi {
  folders(accountId?: string): Promise<Folder[]>;
  list(query: MessageQuery): Promise<MessagePage>;
  get(id: number): Promise<MessageHeader | null>;
  body(id: number, allowRemote?: boolean): Promise<MessageBody>;
  thread(id: number): Promise<MessageHeader[]>;
  setFlags(ids: number[], flags: { seen?: boolean; flagged?: boolean; pinned?: boolean; dueAt?: number | null }): Promise<void>;
  setCategories(ids: number[], categories: string[]): Promise<void>;
  snooze(ids: number[], until: number | null): Promise<void>;
  move(ids: number[], targetFolderId: string): Promise<void>;
  copy(ids: number[], targetFolderId: string): Promise<void>;
  remove(ids: number[], permanent?: boolean): Promise<void>;
  /** True when deleting these messages would remove them for good (already in trash/junk, or no trash folder) */
  isPermanentDelete(ids: number[]): Promise<boolean>;
  archive(ids: number[]): Promise<void>;
  junk(ids: number[], isJunk: boolean): Promise<void>;
  markFolderRead(folderId: string): Promise<void>;
  emptyFolder(folderId: string): Promise<void>;
  createFolder(accountId: string, parentPath: string | null, name: string): Promise<void>;
  renameFolder(folderId: string, newName: string): Promise<void>;
  deleteFolder(folderId: string): Promise<void>;
  setFavorite(folderId: string, favorite: boolean): Promise<void>;
  sync(accountId?: string, folderId?: string): Promise<void>;
  loadMore(folderId: string): Promise<number>;
  syncState(): Promise<SyncState[]>;
  serverSearch(folderId: string, text: string): Promise<MessagePage>;
  saveAttachment(id: number, index: number): Promise<string | null>;
  saveAllAttachments(id: number): Promise<string | null>;
  openAttachment(id: number, index: number): Promise<void>;
  attachmentData(id: number, index: number): Promise<{ filename: string; contentType: string; dataBase64: string }>;
  saveAs(id: number): Promise<string | null>;
  source(id: number): Promise<string>;
  importEml(folderId: string): Promise<number>;
  print(id: number): Promise<void>;
  applyActions(ids: number[], actions: RuleAction[]): Promise<void>;
  unsubscribe(id: number): Promise<string>;
  blockSender(id: number): Promise<void>;
}

export interface ComposeApi {
  /** Builds a reply/forward draft from an existing message */
  prepare(mode: 'reply' | 'replyAll' | 'forward' | 'edit', messageId: number): Promise<Draft>;
  /** Queues the draft in the outbox (undo-send delay / send later); returns the outbox id */
  send(draft: Draft): Promise<string>;
  saveDraft(draft: Draft): Promise<Draft>;
  discardDraft(draft: Draft): Promise<void>;
  pickFiles(): Promise<{ filename: string; contentType: string; size: number; path: string }[]>;
  outbox(): Promise<OutboxItem[]>;
  cancelOutbox(id: string): Promise<Draft | null>;
  retryOutbox(id: string): Promise<void>;
  localDrafts(): Promise<Draft[]>;
  saveLocalDraft(draft: Draft): Promise<void>;
  removeLocalDraft(id: string): Promise<void>;
  suggest(text: string): Promise<{ name: string; address: string }[]>;
}

export interface CalendarApi {
  calendars(): Promise<Calendar[]>;
  saveCalendar(cal: Calendar): Promise<Calendar>;
  removeCalendar(id: string): Promise<void>;
  occurrences(from: number, to: number): Promise<EventOccurrence[]>;
  get(id: string): Promise<CalendarEvent | null>;
  save(ev: CalendarEvent): Promise<CalendarEvent>;
  remove(id: string, occurrenceStart?: number): Promise<void>;
  importIcs(calendarId: string, ics?: string): Promise<number>;
  exportIcs(calendarId: string): Promise<string | null>;
  refreshSubscription(calendarId: string): Promise<number>;
  respond(messageId: number, response: 'accepted' | 'declined' | 'tentative', calendarId: string): Promise<void>;
  sendInvites(eventId: string, accountId: string): Promise<void>;
}

export interface ContactsApi {
  list(search?: string): Promise<Contact[]>;
  save(c: Contact): Promise<Contact>;
  remove(ids: string[]): Promise<void>;
  importVcf(): Promise<number>;
  exportVcf(ids?: string[]): Promise<string | null>;
  importCsv(): Promise<number>;
  byEmail(email: string): Promise<Contact | null>;
}

export interface TasksApi {
  lists(): Promise<TaskList[]>;
  saveList(l: TaskList): Promise<TaskList>;
  removeList(id: string): Promise<void>;
  list(): Promise<Task[]>;
  save(t: Task): Promise<Task>;
  remove(id: string): Promise<void>;
  fromMessage(messageId: number): Promise<Task>;
}

export interface NotesApi {
  list(): Promise<Note[]>;
  save(n: Note): Promise<Note>;
  remove(id: string): Promise<void>;
}

export interface SettingsApi {
  get(): Promise<Settings>;
  update(patch: Partial<Settings>): Promise<Settings>;
  saveRules(rules: Rule[]): Promise<void>;
  runRules(folderId: string): Promise<number>;
  exportAll(): Promise<string | null>;
  importAll(): Promise<boolean>;
}

export interface AppApi {
  info(): Promise<AppInfo>;
  search(text: string): Promise<SearchHit[]>;
  openDataDir(): Promise<void>;
  clearCache(): Promise<void>;
  openExternal(url: string): Promise<void>;
  setBadge(count: number): Promise<void>;
  newWindow(route: string): Promise<void>;
  quit(): Promise<void>;
}

export interface Api {
  accounts: AccountsApi;
  mail: MailApi;
  compose: ComposeApi;
  calendar: CalendarApi;
  contacts: ContactsApi;
  tasks: TasksApi;
  notes: NotesApi;
  settings: SettingsApi;
  app: AppApi;
}

/** Backend → renderer events */
export interface EventMap {
  'mail:changed': { accountId: string; folderIds: string[] };
  'folders:changed': { accountId: string };
  'sync:state': import('./types').SyncState;
  'accounts:changed': null;
  'settings:changed': import('./types').Settings;
  'calendar:changed': null;
  'contacts:changed': null;
  'tasks:changed': null;
  'notes:changed': null;
  'outbox:changed': null;
  notify: Notification;
  toast: { kind: 'info' | 'error' | 'success'; text: string };
  /** Menu / tray / deep-link commands (e.g. 'mail.new', 'mailto:...') */
  command: { command: string; arg?: string };
}

export type EventName = keyof EventMap;
