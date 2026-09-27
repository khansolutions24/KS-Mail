// iCalendar (RFC 5545) parsing and serialisation for the subset KS Mail uses.

import type { Attendee, CalendarEvent, Recurrence } from './types';
import { newId } from './util';

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface Component {
  type: string;
  props: Prop[];
  children: Component[];
}

const WINDOWS_ZONES: Record<string, string> = {
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Russian Standard Time': 'Europe/Moscow',
  'Arabian Standard Time': 'Asia/Dubai',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Mountain Standard Time': 'America/Denver',
  'Central Standard Time': 'America/Chicago',
  'Eastern Standard Time': 'America/New_York',
  'UTC': 'UTC',
  'Coordinated Universal Time': 'UTC'
};

function unfold(text: string): string[] {
  return text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/).filter((l) => l.length > 0);
}

function parseLine(line: string): Prop | null {
  // name;param=value;param="quoted:value":value
  let i = 0;
  let inQuote = false;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ':' && !inQuote) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const parts: string[] = [];
  let cur = '';
  inQuote = false;
  for (const ch of head) {
    if (ch === '"') inQuote = !inQuote;
    if (ch === ';' && !inQuote) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"(.*)"$/, '$1');
  }
  return { name: parts[0].toUpperCase(), params, value };
}

function parseComponents(text: string): Component[] {
  const root: Component = { type: 'ROOT', props: [], children: [] };
  const stack: Component[] = [root];
  for (const line of unfold(text)) {
    const p = parseLine(line);
    if (!p) continue;
    const top = stack[stack.length - 1];
    if (p.name === 'BEGIN') {
      const c: Component = { type: p.value.toUpperCase(), props: [], children: [] };
      top.children.push(c);
      stack.push(c);
    } else if (p.name === 'END') {
      if (stack.length > 1) stack.pop();
    } else top.props.push(p);
  }
  return root.children;
}

export function unescapeText(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

export function escapeText(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function tzOffset(utcMs: number, tz: string): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(utcMs))) if (p.type !== 'literal') parts[p.type] = Number(p.value);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const guess = Date.UTC(y, mo, d, h, mi, s);
  const off1 = tzOffset(guess, tz);
  const t = guess - off1;
  const off2 = tzOffset(t, tz);
  return off1 === off2 ? t : guess - off2;
}

function resolveZone(tzid: string | undefined): string | null {
  if (!tzid) return null;
  const clean = tzid.replace(/^\//, '');
  const mapped = WINDOWS_ZONES[clean] ?? clean;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: mapped });
    return mapped;
  } catch {
    return null;
  }
}

/** Parses DATE / DATE-TIME values. Returns ms and whether it was a date-only value. */
export function parseDate(value: string, params: Record<string, string> = {}): { ms: number; allDay: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  if (m[4] === undefined || params['VALUE'] === 'DATE') return { ms: new Date(y, mo, d).getTime(), allDay: true };
  const [h, mi, s] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  if (m[7]) return { ms: Date.UTC(y, mo, d, h, mi, s), allDay: false };
  const zone = resolveZone(params['TZID']);
  if (zone) return { ms: zonedToUtc(y, mo, d, h, mi, s, zone), allDay: false };
  return { ms: new Date(y, mo, d, h, mi, s).getTime(), allDay: false };
}

export function parseDuration(v: string): number {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return 0;
  const ms =
    (Number(m[2] ?? 0) * 7 * 86400 + Number(m[3] ?? 0) * 86400 + Number(m[4] ?? 0) * 3600 + Number(m[5] ?? 0) * 60 + Number(m[6] ?? 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function parseRRule(v: string): Recurrence | null {
  const parts: Record<string, string> = {};
  for (const kv of v.split(';')) {
    const [k, val] = kv.split('=');
    if (k && val !== undefined) parts[k.toUpperCase()] = val;
  }
  const freq = parts['FREQ'] as Recurrence['freq'];
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  const r: Recurrence = { freq, interval: Number(parts['INTERVAL'] ?? 1) || 1 };
  if (parts['COUNT']) r.count = Number(parts['COUNT']);
  if (parts['UNTIL']) {
    const u = parseDate(parts['UNTIL']);
    if (u) r.until = u.allDay ? u.ms + 86400000 - 1 : u.ms;
  }
  if (parts['BYDAY'] && freq === 'WEEKLY') {
    r.byDay = parts['BYDAY']
      .split(',')
      .map((d) => DAY_CODES.indexOf(d.replace(/^[+-]?\d+/, '').toUpperCase()))
      .filter((d) => d >= 0);
  }
  return r;
}

export function formatRRule(r: Recurrence): string {
  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.byDay?.length) parts.push(`BYDAY=${r.byDay.map((d) => DAY_CODES[d]).join(',')}`);
  if (r.count) parts.push(`COUNT=${r.count}`);
  else if (r.until) parts.push(`UNTIL=${formatUtc(r.until)}`);
  return parts.join(';');
}

function mailto(v: string): string {
  return v.replace(/^mailto:/i, '').trim();
}

const PARTSTAT: Record<string, Attendee['status']> = {
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  TENTATIVE: 'tentative',
  'NEEDS-ACTION': 'needs-action'
};

export interface ParsedCalendar {
  method: string | null;
  events: CalendarEvent[];
}

export function parseIcs(text: string, calendarId = ''): ParsedCalendar {
  const out: CalendarEvent[] = [];
  let method: string | null = null;
  for (const cal of parseComponents(text)) {
    if (cal.type !== 'VCALENDAR') continue;
    method = cal.props.find((p) => p.name === 'METHOD')?.value.toUpperCase() ?? method;
    for (const c of cal.children) {
      if (c.type !== 'VEVENT') continue;
      const get = (n: string): Prop | undefined => c.props.find((p) => p.name === n);
      const dts = get('DTSTART');
      const start = dts ? parseDate(dts.value, dts.params) : null;
      if (!start) continue;
      const dte = get('DTEND');
      let end = dte ? parseDate(dte.value, dte.params)?.ms : undefined;
      if (end === undefined) {
        const dur = get('DURATION');
        end = start.ms + (dur ? parseDuration(dur.value) : start.allDay ? 86400000 : 0);
      }
      const rr = get('RRULE');
      const exdates: number[] = [];
      for (const p of c.props.filter((p) => p.name === 'EXDATE')) {
        for (const v of p.value.split(',')) {
          const d = parseDate(v, p.params);
          if (d) exdates.push(d.ms);
        }
      }
      const alarm = c.children.find((a) => a.type === 'VALARM');
      let reminder: number | null = null;
      const trig = alarm?.props.find((p) => p.name === 'TRIGGER');
      if (trig && !trig.params['VALUE']) reminder = Math.max(0, Math.round(-parseDuration(trig.value) / 60000));
      const org = get('ORGANIZER');
      const transp = get('TRANSP')?.value.toUpperCase();
      const busy = get('X-MICROSOFT-CDO-BUSYSTATUS')?.value.toUpperCase();
      const status = get('STATUS')?.value.toUpperCase();
      const text = (n: string): string => unescapeText(get(n)?.value ?? '');
      out.push({
        id: newId(),
        calendarId,
        uid: get('UID')?.value ?? newId(),
        title: text('SUMMARY') || '(Ohne Titel)',
        location: text('LOCATION'),
        notes: text('DESCRIPTION'),
        start: start.ms,
        end: Math.max(end, start.ms),
        allDay: start.allDay,
        recurrence: rr ? parseRRule(rr.value) : null,
        exdates,
        reminder,
        showAs: busy === 'OOF' ? 'oof' : busy === 'TENTATIVE' || status === 'TENTATIVE' ? 'tentative' : transp === 'TRANSPARENT' || busy === 'FREE' ? 'free' : 'busy',
        organizer: org ? { name: org.params['CN'] ?? '', address: mailto(org.value) } : null,
        attendees: c.props
          .filter((p) => p.name === 'ATTENDEE')
          .map((p) => ({ name: p.params['CN'] ?? '', email: mailto(p.value), status: PARTSTAT[p.params['PARTSTAT'] ?? ''] ?? 'needs-action' })),
        categories: (get('CATEGORIES')?.value ?? '').split(',').map((s) => unescapeText(s).trim()).filter(Boolean),
        isPrivate: ['PRIVATE', 'CONFIDENTIAL'].includes(get('CLASS')?.value.toUpperCase() ?? ''),
        onlineMeetingUrl: get('X-MICROSOFT-SKYPETEAMSMEETINGURL')?.value ?? get('URL')?.value ?? '',
        updated: Date.now()
      });
    }
  }
  return { method, events: out };
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

export function formatUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function formatLocalDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ' ' + rest.slice(74);
  }
  out.push(rest);
  return out.join('\r\n');
}

function quoteParam(v: string): string {
  return /[;:,]/.test(v) ? `"${v.replace(/"/g, "'")}"` : v;
}

export function eventToVEvent(e: CalendarEvent, opts: { partstatFor?: string; partstat?: Attendee['status'] } = {}): string[] {
  const lines = ['BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${formatUtc(Date.now())}`];
  if (e.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatLocalDate(e.start)}`, `DTEND;VALUE=DATE:${formatLocalDate(Math.max(e.end, e.start + 86400000))}`);
  } else {
    lines.push(`DTSTART:${formatUtc(e.start)}`, `DTEND:${formatUtc(e.end)}`);
  }
  lines.push(`SUMMARY:${escapeText(e.title)}`);
  if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
  if (e.notes) lines.push(`DESCRIPTION:${escapeText(e.notes)}`);
  if (e.recurrence) lines.push(`RRULE:${formatRRule(e.recurrence)}`);
  for (const x of e.exdates) lines.push(e.allDay ? `EXDATE;VALUE=DATE:${formatLocalDate(x)}` : `EXDATE:${formatUtc(x)}`);
  if (e.showAs === 'free') lines.push('TRANSP:TRANSPARENT');
  else lines.push('TRANSP:OPAQUE');
  if (e.showAs === 'tentative') lines.push('STATUS:TENTATIVE');
  lines.push(`X-MICROSOFT-CDO-BUSYSTATUS:${{ busy: 'BUSY', free: 'FREE', tentative: 'TENTATIVE', oof: 'OOF' }[e.showAs]}`);
  if (e.categories.length) lines.push(`CATEGORIES:${e.categories.map(escapeText).join(',')}`);
  if (e.isPrivate) lines.push('CLASS:PRIVATE');
  if (e.onlineMeetingUrl) lines.push(`URL:${e.onlineMeetingUrl}`);
  if (e.organizer) lines.push(`ORGANIZER;CN=${quoteParam(e.organizer.name || e.organizer.address)}:mailto:${e.organizer.address}`);
  for (const a of e.attendees) {
    const status = opts.partstatFor && a.email.toLowerCase() === opts.partstatFor.toLowerCase() && opts.partstat ? opts.partstat : a.status;
    lines.push(`ATTENDEE;CN=${quoteParam(a.name || a.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=${status.toUpperCase()};RSVP=TRUE:mailto:${a.email}`);
  }
  if (e.reminder != null) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(e.title)}`, `TRIGGER:-PT${e.reminder}M`, 'END:VALARM');
  }
  lines.push('END:VEVENT');
  return lines;
}

export function buildIcs(events: CalendarEvent[], opts: { method?: string; name?: string; partstatFor?: string; partstat?: Attendee['status'] } = {}): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KS//KS Mail//DE', 'CALSCALE:GREGORIAN'];
  if (opts.method) lines.push(`METHOD:${opts.method}`);
  if (opts.name) lines.push(`X-WR-CALNAME:${escapeText(opts.name)}`);
  for (const e of events) lines.push(...eventToVEvent(e, opts));
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
