// Date and time formatting (German).

const DAY = 86400000;

export function startOfDay(t: number | Date): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(t: number, n: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function startOfWeek(t: number, weekStart: number): number {
  const d = new Date(startOfDay(t));
  const diff = (d.getDay() - weekStart + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.getTime();
}

export function startOfMonth(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

export function time(t: number): string {
  return new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/** List date like Outlook: time today, weekday this week, date otherwise */
export function listDate(t: number): string {
  const now = Date.now();
  const today = startOfDay(now);
  if (t >= today) return time(t);
  if (t >= today - 6 * DAY) return new Date(t).toLocaleDateString('de-DE', { weekday: 'short' }) + ' ' + time(t);
  if (new Date(t).getFullYear() === new Date(now).getFullYear()) return new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  return new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function longDate(t: number): string {
  return new Date(t).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function dayLabel(t: number): string {
  return new Date(t).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** Group heading in the message list */
export function groupLabel(t: number): string {
  const today = startOfDay(Date.now());
  if (t >= today) return 'Heute';
  if (t >= today - DAY) return 'Gestern';
  const weekStart = startOfWeek(Date.now(), 1);
  if (t >= weekStart) return 'Diese Woche';
  if (t >= weekStart - 7 * DAY) return 'Letzte Woche';
  const d = new Date(t);
  const n = new Date();
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth()) return 'Diesen Monat';
  if (d.getFullYear() === n.getFullYear()) return d.toLocaleDateString('de-DE', { month: 'long' });
  return String(d.getFullYear());
}

export function isoWeek(t: number): number {
  const d = new Date(startOfDay(t));
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - w1.getTime()) / DAY - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

export function toInputDate(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function toInputTime(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fromInputs(date: string, timeStr = '00:00'): number {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, h || 0, mi || 0).getTime();
}

export function toInputDateTime(t: number): string {
  return `${toInputDate(t)}T${toInputTime(t)}`;
}

export function fromInputDateTime(v: string): number {
  const [d, t] = v.split('T');
  return fromInputs(d, t);
}

export function minutesLabel(m: number): string {
  if (m === 0) return 'Zum Zeitpunkt';
  if (m < 60) return `${m} Minuten vorher`;
  if (m < 1440) return `${m / 60} Stunde${m === 60 ? '' : 'n'} vorher`;
  if (m < 10080) return `${m / 1440} Tag${m === 1440 ? '' : 'e'} vorher`;
  return `${m / 10080} Woche${m === 10080 ? '' : 'n'} vorher`;
}

export const REMINDER_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];
