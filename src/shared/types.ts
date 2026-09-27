// Domain types shared by backend and renderer.

export type AuthMethod = 'password' | 'oauth2';
export type Security = 'tls' | 'starttls' | 'none';
export type OAuthProvider = 'microsoft' | 'google';

export interface ServerConfig {
  host: string;
  port: number;
  security: Security;
  user: string;
  /** Only present when the renderer sends a changed password; never returned by the backend */
  password?: string;
  /** Skip certificate validation (self-signed servers) */
  allowInvalidCert?: boolean;
}

export interface Account {
  id: string;
  kind: 'imap' | 'demo';
  name: string;
  displayName: string;
  email: string;
  color: string;
  auth: AuthMethod;
  oauthProvider?: OAuthProvider;
  imap: ServerConfig;
  smtp: ServerConfig;
  /** true when a password / refresh token is stored */
  hasSecret?: boolean;
  signatureId?: string;
  /** Minutes between full syncs; IDLE push is used for the inbox in between */
  syncInterval: number;
  /** Messages loaded per folder on first sync */
  initialLimit: number;
  enabled: boolean;
  /** Save a copy of sent mail in the Sent folder (off for Gmail/Outlook.com, which do it themselves) */
  saveSent: boolean;
  sortOrder: number;
}

export type SpecialUse = 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | 'flagged' | 'all' | null;

export interface Folder {
  id: string;
  accountId: string;
  path: string;
  name: string;
  delimiter: string;
  parentPath: string | null;
  specialUse: SpecialUse;
  unread: number;
  total: number;
  subscribed: boolean;
  /** false for \Noselect containers */
  selectable: boolean;
  favorite: boolean;
}

export interface Address {
  name: string;
  address: string;
}

export interface MessageHeader {
  id: number;
  accountId: string;
  folderId: string;
  uid: number;
  messageId: string;
  inReplyTo: string;
  threadKey: string;
  subject: string;
  from: Address;
  to: Address[];
  cc: Address[];
  date: number;
  size: number;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  forwarded: boolean;
  draft: boolean;
  hasAttachments: boolean;
  snippet: string;
  categories: string[];
  /** Follow-up due date for flagged mails (ms) */
  dueAt: number | null;
  /** Snoozed until (ms): hidden from the list until then */
  snoozedUntil: number | null;
  pinned: boolean;
}

export interface AttachmentInfo {
  index: number;
  filename: string;
  contentType: string;
  size: number;
  contentId: string | null;
  inline: boolean;
}

export interface MessageBody {
  id: number;
  html: string | null;
  text: string;
  attachments: AttachmentInfo[];
  /** html contains http(s) images that were blocked */
  hasRemoteContent: boolean;
  headers: { key: string; value: string }[];
  replyTo: Address[];
  bcc: Address[];
  references: string[];
  /** Attached calendar invitation (text/calendar) parsed into events */
  invite: CalendarEvent[] | null;
  listUnsubscribe: string | null;
}

export type SortField = 'date' | 'from' | 'subject' | 'size' | 'flagged';

export interface MessageQuery {
  /** Folder id, or one of the virtual views */
  folderId: string;
  search?: string;
  filter?: 'all' | 'unread' | 'flagged' | 'attachments' | 'focused' | 'other';
  sort?: SortField;
  desc?: boolean;
  offset?: number;
  limit?: number;
  category?: string;
}

/** Virtual folders across all accounts */
export const VIRTUAL = {
  unifiedInbox: 'virtual:inbox',
  unread: 'virtual:unread',
  flagged: 'virtual:flagged',
  snoozed: 'virtual:snoozed'
} as const;

export interface MessagePage {
  total: number;
  items: MessageHeader[];
}

export interface Draft {
  /** Local draft id (stable while editing) */
  id: string;
  accountId: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  html: string;
  attachments: DraftAttachment[];
  inReplyTo?: string;
  references?: string[];
  /** Message this draft answers/forwards (to set \Answered / $Forwarded after sending) */
  sourceMessageId?: number;
  mode?: 'new' | 'reply' | 'replyAll' | 'forward' | 'edit';
  importance?: 'high' | 'normal' | 'low';
  requestReadReceipt?: boolean;
  /** Stored copy on the server (Drafts folder) */
  serverDraftMessageId?: number;
  /** Send later: timestamp (ms) */
  sendAt?: number | null;
  /** Send as plain text only (no HTML part) */
  plainText?: boolean;
}

export interface DraftAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  /** base64 content (renderer → backend) or local file path */
  dataBase64?: string;
  path?: string;
  /** Forwarded attachment from an existing message */
  fromMessage?: { messageId: number; index: number };
}

export interface Signature {
  id: string;
  name: string;
  html: string;
}

export type RuleField = 'from' | 'to' | 'cc' | 'subject' | 'body' | 'anyRecipient' | 'header';
export type RuleOp = 'contains' | 'notContains' | 'equals' | 'startsWith' | 'endsWith' | 'regex';

export interface RuleCondition {
  field: RuleField | 'hasAttachment' | 'sizeGreater' | 'importance';
  op?: RuleOp;
  value: string;
  headerName?: string;
}

export type RuleAction =
  | { type: 'move'; folderPath: string }
  | { type: 'copy'; folderPath: string }
  | { type: 'markRead' }
  | { type: 'flag' }
  | { type: 'delete' }
  | { type: 'category'; category: string }
  | { type: 'forward'; to: string }
  | { type: 'notify'; text: string }
  | { type: 'pin' };

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  /** null = all accounts */
  accountId: string | null;
  match: 'all' | 'any';
  conditions: RuleCondition[];
  actions: RuleAction[];
  stopProcessing: boolean;
}

export interface Category {
  name: string;
  color: string;
}

export interface Calendar {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  /** Remote ICS subscription URL (read-only) */
  subscriptionUrl?: string;
}

export type Recurrence = {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  /** 0 = Sunday … 6 = Saturday, only for WEEKLY */
  byDay?: number[];
  count?: number;
  /** ms, inclusive */
  until?: number;
};

export interface Attendee {
  name: string;
  email: string;
  status: 'needs-action' | 'accepted' | 'declined' | 'tentative';
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  uid: string;
  title: string;
  location: string;
  notes: string;
  start: number;
  end: number;
  allDay: boolean;
  recurrence: Recurrence | null;
  /** Occurrence starts (ms) removed from a recurring series */
  exdates: number[];
  /** Minutes before start; null = no reminder */
  reminder: number | null;
  showAs: 'busy' | 'free' | 'tentative' | 'oof';
  organizer: Address | null;
  attendees: Attendee[];
  categories: string[];
  isPrivate: boolean;
  onlineMeetingUrl: string;
  updated: number;
}

/** A concrete occurrence of an event within a range */
export interface EventOccurrence {
  event: CalendarEvent;
  start: number;
  end: number;
}

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  emails: { label: string; value: string }[];
  phones: { label: string; value: string }[];
  company: string;
  jobTitle: string;
  department: string;
  address: { street: string; zip: string; city: string; country: string };
  website: string;
  birthday: string;
  notes: string;
  groups: string[];
  favorite: boolean;
  /** Collected automatically from sent mail */
  collected: boolean;
  updated: number;
}

export interface TaskList {
  id: string;
  name: string;
  color: string;
}

export interface Task {
  id: string;
  listId: string;
  title: string;
  notes: string;
  due: number | null;
  reminder: number | null;
  priority: 'low' | 'normal' | 'high';
  done: boolean;
  important: boolean;
  myDay: boolean;
  steps: { id: string; title: string; done: boolean }[];
  recurrence: Recurrence | null;
  /** Created from an email */
  messageId: number | null;
  created: number;
  completedAt: number | null;
  sortOrder: number;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  color: string;
  updated: number;
}

export type Theme = 'system' | 'light' | 'dark';
export type Density = 'compact' | 'comfortable' | 'spacious';

export interface Shortcut {
  command: string;
  keys: string;
}

export interface Settings {
  theme: Theme;
  accentColor: string;
  density: Density;
  fontSize: number;
  language: 'de' | 'en';
  startMinimized: boolean;
  launchAtLogin: boolean;
  closeToTray: boolean;
  defaultAccountId: string | null;
  mail: {
    readingPane: 'right' | 'bottom' | 'off';
    markReadAfter: number; // seconds, -1 = never, 0 = immediately
    remoteImages: 'never' | 'ask' | 'always' | 'contacts';
    confirmDelete: boolean;
    conversationView: boolean;
    showSnippet: boolean;
    composeFormat: 'html' | 'text';
    composeFont: string;
    composeFontSize: number;
    replyQuotePosition: 'top' | 'bottom';
    undoSendSeconds: number;
    focusedInbox: boolean;
    emptyTrashOnExit: boolean;
    collectRecipients: boolean;
    defaultSignatureId: string | null;
    signatureOnReply: boolean;
    autoAdvance: 'next' | 'previous' | 'list';
    sendReadReceipts: 'never' | 'ask' | 'always';
  };
  notifications: {
    enabled: boolean;
    sound: boolean;
    showPreview: boolean;
    onlyInbox: boolean;
    badge: boolean;
    quietHoursFrom: string; // "22:00", '' = off
    quietHoursTo: string;
  };
  calendar: {
    weekStart: 0 | 1 | 6;
    workDays: number[];
    workStart: string;
    workEnd: string;
    defaultReminder: number | null;
    defaultDuration: number;
    defaultView: 'day' | 'workweek' | 'week' | 'month' | 'agenda';
    showWeekNumbers: boolean;
    timeScale: 15 | 30 | 60;
    defaultCalendarId: string | null;
  };
  outOfOffice: {
    enabled: boolean;
    from: number | null;
    to: number | null;
    subject: string;
    text: string;
    onlyContacts: boolean;
  };
  oauth: {
    microsoftClientId: string;
    microsoftTenant: string;
    googleClientId: string;
    googleClientSecret: string;
  };
  shortcuts: Shortcut[];
  signatures: Signature[];
  rules: Rule[];
  categories: Category[];
  quickSteps: QuickStep[];
  templates: MailTemplate[];
  favorites: string[];
  blockedSenders: string[];
  safeSenders: string[];
}

export interface QuickStep {
  id: string;
  name: string;
  icon: string;
  actions: RuleAction[];
}

export interface MailTemplate {
  id: string;
  name: string;
  subject: string;
  html: string;
}

export interface SyncState {
  accountId: string;
  status: 'idle' | 'syncing' | 'error' | 'offline';
  message: string;
  lastSync: number | null;
}

export interface OutboxItem {
  id: string;
  accountId: string;
  subject: string;
  to: string;
  sendAt: number;
  status: 'queued' | 'sending' | 'failed';
  error: string;
}

export interface Notification {
  kind: 'mail' | 'reminder' | 'info' | 'error';
  title: string;
  body: string;
  ref?: { messageId?: number; eventId?: string; taskId?: string };
}

export interface SearchHit {
  kind: 'mail' | 'event' | 'contact' | 'task';
  id: string;
  title: string;
  subtitle: string;
  date: number | null;
}

export interface AppInfo {
  version: string;
  platform: string;
  dataDir: string;
  secureStorage: boolean;
  electron: boolean;
}
