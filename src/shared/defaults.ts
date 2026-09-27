// Default settings, account templates and provider presets.

import type { Account, Calendar, Settings, TaskList } from './types';
import { newId } from './util';

export const DEFAULT_CATEGORIES = [
  { name: 'Rot', color: '#d13438' },
  { name: 'Orange', color: '#ca5010' },
  { name: 'Gelb', color: '#c19c00' },
  { name: 'Grün', color: '#107c10' },
  { name: 'Blau', color: '#0f6cbd' },
  { name: 'Lila', color: '#8764b8' },
  { name: 'Wichtig', color: '#e3008c' },
  { name: 'Privat', color: '#038387' }
];

export function defaultSettings(): Settings {
  return {
    theme: 'system',
    accentColor: '#0f6cbd',
    density: 'comfortable',
    fontSize: 14,
    language: 'de',
    startMinimized: false,
    launchAtLogin: false,
    closeToTray: true,
    defaultAccountId: null,
    mail: {
      readingPane: 'right',
      markReadAfter: 2,
      remoteImages: 'ask',
      confirmDelete: false,
      conversationView: false,
      showSnippet: true,
      composeFormat: 'html',
      composeFont: 'Segoe UI, -apple-system, Helvetica, Arial, sans-serif',
      composeFontSize: 11,
      replyQuotePosition: 'top',
      undoSendSeconds: 5,
      focusedInbox: false,
      emptyTrashOnExit: false,
      collectRecipients: true,
      defaultSignatureId: null,
      signatureOnReply: true,
      autoAdvance: 'next',
      sendReadReceipts: 'ask'
    },
    notifications: {
      enabled: true,
      sound: true,
      showPreview: true,
      onlyInbox: true,
      badge: true,
      quietHoursFrom: '',
      quietHoursTo: ''
    },
    calendar: {
      weekStart: 1,
      workDays: [1, 2, 3, 4, 5],
      workStart: '08:00',
      workEnd: '17:00',
      defaultReminder: 15,
      defaultDuration: 30,
      defaultView: 'workweek',
      showWeekNumbers: true,
      timeScale: 30,
      defaultCalendarId: null
    },
    outOfOffice: { enabled: false, from: null, to: null, subject: 'Abwesenheitsnotiz', text: '', onlyContacts: false },
    oauth: { microsoftClientId: '', microsoftTenant: 'common', googleClientId: '', googleClientSecret: '' },
    shortcuts: [],
    signatures: [],
    rules: [],
    categories: DEFAULT_CATEGORIES,
    quickSteps: [
      { id: 'qs-done', name: 'Erledigt', icon: 'check', actions: [{ type: 'markRead' }, { type: 'move', folderPath: '@archive' }] },
      { id: 'qs-team', name: 'Später lesen', icon: 'clock', actions: [{ type: 'flag' }, { type: 'markRead' }] }
    ],
    templates: [],
    favorites: [],
    blockedSenders: [],
    safeSenders: []
  };
}

export function defaultAccount(): Account {
  return {
    id: newId(),
    kind: 'imap',
    name: '',
    displayName: '',
    email: '',
    color: '#0f6cbd',
    auth: 'password',
    imap: { host: '', port: 993, security: 'tls', user: '' },
    smtp: { host: '', port: 587, security: 'starttls', user: '' },
    syncInterval: 5,
    initialLimit: 500,
    enabled: true,
    saveSent: true,
    sortOrder: 0
  };
}

export function defaultCalendar(): Calendar {
  return { id: 'default', name: 'Kalender', color: '#0f6cbd', visible: true };
}

export function defaultTaskList(): TaskList {
  return { id: 'default', name: 'Aufgaben', color: '#0f6cbd' };
}

type Preset = {
  domains: string[];
  imap: [string, number, 'tls' | 'starttls'];
  smtp: [string, number, 'tls' | 'starttls'];
  oauth?: 'microsoft' | 'google';
  /** Provider stores sent mail itself */
  autoSent?: boolean;
  name: string;
};

export const PROVIDERS: Preset[] = [
  { name: 'Gmail', domains: ['gmail.com', 'googlemail.com'], imap: ['imap.gmail.com', 993, 'tls'], smtp: ['smtp.gmail.com', 465, 'tls'], oauth: 'google', autoSent: true },
  {
    name: 'Outlook.com / Microsoft 365',
    domains: ['outlook.com', 'outlook.de', 'hotmail.com', 'hotmail.de', 'live.com', 'live.de', 'msn.com'],
    imap: ['outlook.office365.com', 993, 'tls'],
    smtp: ['smtp-mail.outlook.com', 587, 'starttls'],
    oauth: 'microsoft',
    autoSent: true
  },
  { name: 'iCloud', domains: ['icloud.com', 'me.com', 'mac.com'], imap: ['imap.mail.me.com', 993, 'tls'], smtp: ['smtp.mail.me.com', 587, 'starttls'] },
  { name: 'Yahoo', domains: ['yahoo.com', 'yahoo.de'], imap: ['imap.mail.yahoo.com', 993, 'tls'], smtp: ['smtp.mail.yahoo.com', 465, 'tls'] },
  { name: 'GMX', domains: ['gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch', 'gmx.com'], imap: ['imap.gmx.net', 993, 'tls'], smtp: ['mail.gmx.net', 587, 'starttls'] },
  { name: 'WEB.DE', domains: ['web.de'], imap: ['imap.web.de', 993, 'tls'], smtp: ['smtp.web.de', 587, 'starttls'] },
  { name: 'T-Online', domains: ['t-online.de', 'magenta.de'], imap: ['secureimap.t-online.de', 993, 'tls'], smtp: ['securesmtp.t-online.de', 465, 'tls'] },
  { name: 'IONOS', domains: ['ionos.de', 'online.de', '1und1.de'], imap: ['imap.ionos.de', 993, 'tls'], smtp: ['smtp.ionos.de', 587, 'starttls'] },
  { name: 'Freenet', domains: ['freenet.de'], imap: ['mx.freenet.de', 993, 'tls'], smtp: ['mx.freenet.de', 587, 'starttls'] },
  { name: 'Posteo', domains: ['posteo.de', 'posteo.net'], imap: ['posteo.de', 993, 'tls'], smtp: ['posteo.de', 587, 'starttls'] },
  { name: 'mailbox.org', domains: ['mailbox.org'], imap: ['imap.mailbox.org', 993, 'tls'], smtp: ['smtp.mailbox.org', 465, 'tls'] },
  { name: 'Strato', domains: ['strato.de'], imap: ['imap.strato.de', 993, 'tls'], smtp: ['smtp.strato.de', 465, 'tls'] },
  { name: 'Zoho', domains: ['zoho.com', 'zohomail.com', 'zohomail.eu'], imap: ['imap.zoho.eu', 993, 'tls'], smtp: ['smtp.zoho.eu', 465, 'tls'] },
  { name: 'Proton Mail Bridge', domains: ['proton.me', 'protonmail.com'], imap: ['127.0.0.1', 1143, 'starttls'], smtp: ['127.0.0.1', 1025, 'starttls'] }
];

export function presetFor(email: string): Preset | null {
  const domain = email.split('@')[1]?.toLowerCase().trim();
  if (!domain) return null;
  return PROVIDERS.find((p) => p.domains.includes(domain)) ?? null;
}
