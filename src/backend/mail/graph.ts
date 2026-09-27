// Microsoft Graph for Microsoft 365 / Outlook.com accounts: sending (when SMTP AUTH is disabled) and the Exchange calendar.

import type { Attendee, CalendarEvent, Recurrence } from '@shared/types';

const BASE = 'https://graph.microsoft.com/v1.0';

export class GraphError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string
  ) {
    super(message);
  }
}

async function call<T>(token: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const url = path.startsWith('https://') ? path : BASE + path;
  const init: RequestInit = { method, headers: { authorization: `Bearer ${token}`, ...headers } };
  if (body !== undefined) {
    if (typeof body === 'string') init.body = body;
    else {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
    }
  }
  const res = await fetch(url, init);
  if (res.status === 204 || res.status === 202) return undefined as T;
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const err = (json.error ?? {}) as { code?: string; message?: string };
    throw new GraphError(describe(res.status, err.code ?? '', err.message ?? res.statusText), res.status, err.code ?? '');
  }
  return json as T;
}

function describe(status: number, code: string, message: string): string {
  if (status === 401 || code === 'InvalidAuthenticationToken') return 'Microsoft 365 hat die Anmeldung abgelehnt – bitte das Konto in den Einstellungen erneut mit Microsoft anmelden.';
  if (status === 403 || code === 'ErrorAccessDenied') return `Keine Berechtigung bei Microsoft 365 (${message}). Bitte erneut anmelden und den Zugriff auf E-Mail-Versand und Kalender bestätigen.`;
  if (code === 'MailboxNotEnabledForRESTAPI') return 'Für dieses Postfach ist die Microsoft-365-Schnittstelle nicht verfügbar (nur Exchange Online wird unterstützt).';
  return `Microsoft 365: ${message}`;
}

async function all<T>(token: string, path: string, headers: Record<string, string> = {}): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = path;
  for (let i = 0; next && i < 50; i++) {
    const page: { value: T[]; '@odata.nextLink'?: string } = await call(token, 'GET', next, undefined, headers);
    out.push(...page.value);
    next = page['@odata.nextLink'];
  }
  return out;
}

/** Sends a complete MIME message (incl. Bcc header); Exchange stores the copy in "Gesendete Elemente" itself */
export async function sendMime(token: string, raw: Buffer): Promise<void> {
  await call(token, 'POST', '/me/sendMail', raw.toString('base64'), { 'content-type': 'text/plain' });
}

export async function checkAccess(token: string): Promise<void> {
  await call(token, 'GET', '/me/calendars?$top=1&$select=id');
}

// ───────────────────────── calendar ─────────────────────────

export interface GraphCalendar {
  id: string;
  name: string;
  hexColor?: string;
  isDefaultCalendar?: boolean;
  canEdit?: boolean;
}

interface GDate {
  dateTime: string;
  timeZone: string;
}

interface GEvent {
  id: string;
  iCalUId: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType: string; content: string };
  start: GDate;
  end: GDate;
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string;
  isReminderOn?: boolean;
  reminderMinutesBeforeStart?: number;
  categories?: string[];
  sensitivity?: string;
  location?: { displayName?: string };
  onlineMeeting?: { joinUrl?: string } | null;
  onlineMeetingUrl?: string | null;
  organizer?: { emailAddress?: { name?: string; address?: string } };
  attendees?: { emailAddress?: { name?: string; address?: string }; status?: { response?: string } }[];
  type?: string;
  seriesMasterId?: string | null;
  recurrence?: unknown;
  lastModifiedDateTime?: string;
}

const PREFER = { prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"' };

export async function calendars(token: string): Promise<GraphCalendar[]> {
  return all<GraphCalendar>(token, '/me/calendars?$select=id,name,hexColor,isDefaultCalendar,canEdit&$top=100');
}

function utcMs(d: GDate): number {
  // with outlook.timezone="UTC" all values come without offset
  return Date.parse(d.dateTime.replace(/(\.\d{3})\d*$/, '$1') + (/[zZ]|[+-]\d\d:\d\d$/.test(d.dateTime) ? '' : 'Z'));
}

/** All-day values are floating dates: take the calendar date, midnight local time */
function floatingDate(d: GDate): number {
  const [y, m, day] = d.dateTime.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, day).getTime();
}

const RESPONSE: Record<string, Attendee['status']> = { accepted: 'accepted', declined: 'declined', tentativelyAccepted: 'tentative', organizer: 'accepted' };
const SHOW_AS: Record<string, CalendarEvent['showAs']> = { free: 'free', tentative: 'tentative', busy: 'busy', oof: 'oof', workingElsewhere: 'busy' };

export function toLocalEvent(g: GEvent, calendarId: string): CalendarEvent {
  const allDay = !!g.isAllDay;
  return {
    id: '',
    calendarId,
    uid: g.iCalUId,
    title: g.subject || '(Ohne Titel)',
    location: g.location?.displayName ?? '',
    notes: g.body?.contentType === 'text' ? g.body.content.trim() : (g.bodyPreview ?? ''),
    start: allDay ? floatingDate(g.start) : utcMs(g.start),
    end: allDay ? floatingDate(g.end) : utcMs(g.end),
    allDay,
    recurrence: null,
    exdates: [],
    reminder: g.isReminderOn ? (g.reminderMinutesBeforeStart ?? 15) : null,
    showAs: SHOW_AS[g.showAs ?? 'busy'] ?? 'busy',
    organizer: g.organizer?.emailAddress?.address ? { name: g.organizer.emailAddress.name ?? '', address: g.organizer.emailAddress.address } : null,
    attendees: (g.attendees ?? [])
      .filter((a) => a.emailAddress?.address)
      .map((a) => ({ name: a.emailAddress?.name ?? '', email: a.emailAddress?.address ?? '', status: RESPONSE[a.status?.response ?? ''] ?? 'needs-action' })),
    categories: g.categories ?? [],
    isPrivate: g.sensitivity === 'private' || g.sensitivity === 'confidential',
    onlineMeetingUrl: g.onlineMeeting?.joinUrl ?? g.onlineMeetingUrl ?? '',
    updated: g.lastModifiedDateTime ? Date.parse(g.lastModifiedDateTime) : Date.now(),
    remote: { kind: 'graph', id: g.id, seriesMasterId: g.seriesMasterId ?? null }
  };
}

/** Expanded occurrences (series are delivered as individual instances) in [from, to) */
export async function calendarView(token: string, calendarId: string, from: number, to: number): Promise<GEvent[]> {
  const q = `startDateTime=${new Date(from).toISOString()}&endDateTime=${new Date(to).toISOString()}&$top=250`;
  const list = await all<GEvent>(token, `/me/calendars/${encodeURIComponent(calendarId)}/calendarView?${q}`, PREFER);
  return list.filter((e) => !e.isCancelled);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function gDate(ms: number, allDay: boolean): GDate {
  if (allDay) {
    const d = new Date(ms);
    return { dateTime: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00`, timeZone: 'UTC' };
  }
  return { dateTime: new Date(ms).toISOString().replace('Z', ''), timeZone: 'UTC' };
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function toGraphRecurrence(r: Recurrence, start: number): unknown {
  const d = new Date(start);
  const pattern: Record<string, unknown> = { interval: Math.max(1, r.interval || 1) };
  switch (r.freq) {
    case 'DAILY':
      pattern.type = 'daily';
      break;
    case 'WEEKLY':
      pattern.type = 'weekly';
      pattern.daysOfWeek = (r.byDay?.length ? r.byDay : [d.getDay()]).map((x) => WEEKDAYS[x]);
      pattern.firstDayOfWeek = 'monday';
      break;
    case 'MONTHLY':
      pattern.type = 'absoluteMonthly';
      pattern.dayOfMonth = d.getDate();
      break;
    case 'YEARLY':
      pattern.type = 'absoluteYearly';
      pattern.dayOfMonth = d.getDate();
      pattern.month = d.getMonth() + 1;
      break;
  }
  const startDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  let range: Record<string, unknown> = { type: 'noEnd', startDate };
  if (r.count) range = { type: 'numbered', startDate, numberOfOccurrences: r.count };
  else if (r.until) {
    const u = new Date(r.until);
    range = { type: 'endDate', startDate, endDate: `${u.getFullYear()}-${pad(u.getMonth() + 1)}-${pad(u.getDate())}` };
  }
  return { pattern, range };
}

function toGraph(e: CalendarEvent, withRecurrence: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    subject: e.title,
    body: { contentType: 'text', content: e.notes },
    start: gDate(e.start, e.allDay),
    end: gDate(e.allDay ? Math.max(e.end, e.start + 86400_000) : e.end, e.allDay),
    isAllDay: e.allDay,
    location: { displayName: e.location },
    showAs: { busy: 'busy', free: 'free', tentative: 'tentative', oof: 'oof' }[e.showAs],
    isReminderOn: e.reminder != null,
    reminderMinutesBeforeStart: e.reminder ?? 0,
    categories: e.categories,
    sensitivity: e.isPrivate ? 'private' : 'normal',
    attendees: e.attendees.map((a) => ({ emailAddress: { name: a.name || a.email, address: a.email }, type: 'required' }))
  };
  if (withRecurrence && e.recurrence) body.recurrence = toGraphRecurrence(e.recurrence, e.start);
  return body;
}

export async function createEvent(token: string, calendarId: string, e: CalendarEvent): Promise<string> {
  const r = await call<{ id: string }>(token, 'POST', `/me/calendars/${encodeURIComponent(calendarId)}/events`, toGraph(e, true), PREFER);
  return r.id;
}

export async function updateEvent(token: string, eventId: string, e: CalendarEvent): Promise<void> {
  // single occurrences of a series cannot carry a recurrence pattern
  await call(token, 'PATCH', `/me/events/${encodeURIComponent(eventId)}`, toGraph(e, false), PREFER);
}

export async function deleteEvent(token: string, eventId: string): Promise<void> {
  await call(token, 'DELETE', `/me/events/${encodeURIComponent(eventId)}`);
}

/** Answers a meeting invitation that Exchange already put into the calendar (matched by iCalendar UID) */
export async function respondByUid(token: string, uid: string, response: 'accepted' | 'declined' | 'tentative', comment: string): Promise<boolean> {
  const found = await call<{ value: { id: string }[] }>(token, 'GET', `/me/events?$filter=iCalUId eq '${uid.replace(/'/g, "''")}'&$select=id&$top=1`);
  const id = found.value[0]?.id;
  if (!id) return false;
  const action = { accepted: 'accept', declined: 'decline', tentative: 'tentativelyAccept' }[response];
  await call(token, 'POST', `/me/events/${encodeURIComponent(id)}/${action}`, { comment, sendResponse: true });
  return true;
}
