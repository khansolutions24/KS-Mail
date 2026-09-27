// Calendar (collection) operations: create, subscribe, rename, recolor, import/export, delete.

import type { Calendar } from '@shared/types';
import { api } from '../api/client';
import { attempt, confirm, prompt, toast } from '../store/app';
import { defaultCalendarId } from './actions';
import { useCalendar } from './store';

export const COLOR_NAMES: Record<string, string> = {
  '#0f6cbd': 'Blau',
  '#8764b8': 'Lavendel',
  '#c239b3': 'Orchidee',
  '#e3008c': 'Magenta',
  '#d13438': 'Rot',
  '#ca5010': 'Orange',
  '#c19c00': 'Gold',
  '#498205': 'Hellgrün',
  '#107c10': 'Grün',
  '#038387': 'Türkis',
  '#00666d': 'Petrol',
  '#5c2e91': 'Violett',
  '#69797e': 'Grau',
  '#393939': 'Anthrazit'
};
export const CALENDAR_COLORS = Object.keys(COLOR_NAMES);

/** First palette color not used by an existing calendar */
function nextColor(): string {
  const used = new Set(useCalendar.getState().calendars.map((c) => c.color.toLowerCase()));
  return CALENDAR_COLORS.find((c) => !used.has(c)) ?? CALENDAR_COLORS[useCalendar.getState().calendars.length % CALENDAR_COLORS.length];
}

async function save(cal: Calendar, success?: string): Promise<Calendar | undefined> {
  const saved = await attempt(() => api.calendar.saveCalendar(cal), success);
  if (saved) await useCalendar.getState().loadCalendars();
  return saved;
}

/** Calendar targeted by import/export commands */
export function targetCalendarId(): string {
  const { activeCalendarId, calendars } = useCalendar.getState();
  return calendars.some((c) => c.id === activeCalendarId) ? activeCalendarId! : defaultCalendarId();
}

export async function createCalendar(): Promise<void> {
  const name = await prompt('Neuer Kalender', '', 'Name', 'Erstellen');
  if (!name?.trim()) return;
  const cal = await save({ id: '', name: name.trim(), color: nextColor(), visible: true }, 'Kalender erstellt');
  if (cal) useCalendar.getState().setActiveCalendar(cal.id);
}

export async function subscribeCalendar(): Promise<void> {
  const raw = await prompt('Internetkalender abonnieren', '', 'Adresse des Kalenders (webcal:// oder https://)', 'Abonnieren');
  const url = raw?.trim();
  if (!url) return;
  if (!/^(webcals?|https?):\/\/\S+$/i.test(url)) {
    toast('error', 'Bitte eine gültige webcal://- oder https://-Adresse eingeben.');
    return;
  }
  const name = await prompt('Internetkalender abonnieren', suggestName(url), 'Name', 'Hinzufügen');
  if (!name?.trim()) return;
  const cal = await save({ id: '', name: name.trim(), color: nextColor(), visible: true, subscriptionUrl: url });
  if (!cal) return;
  const n = await attempt(() => api.calendar.refreshSubscription(cal.id));
  if (n !== undefined) toast('success', `Kalender abonniert: ${n} Termin${n === 1 ? '' : 'e'} geladen`);
}

/** "https://example.org/cal/holidays.ics" → "holidays" (fallback: host name) */
function suggestName(url: string): string {
  try {
    const u = new URL(url.replace(/^webcals?:/i, 'https:'));
    const file = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '').replace(/\.(ics|ical)$/i, '');
    return file && file.length < 40 ? file : u.hostname;
  } catch {
    return 'Internetkalender';
  }
}

export async function renameCalendar(cal: Calendar): Promise<void> {
  const name = await prompt('Kalender umbenennen', cal.name, 'Name', 'Umbenennen');
  if (name?.trim() && name.trim() !== cal.name) await save({ ...cal, name: name.trim() });
}

export async function recolorCalendar(cal: Calendar, color: string): Promise<void> {
  // optimistic so the swatch change is visible immediately
  useCalendar.setState({ calendars: useCalendar.getState().calendars.map((c) => (c.id === cal.id ? { ...c, color } : c)) });
  await save({ ...cal, color });
}

export async function toggleVisible(cal: Calendar, visible: boolean): Promise<void> {
  useCalendar.setState({ calendars: useCalendar.getState().calendars.map((c) => (c.id === cal.id ? { ...c, visible } : c)) });
  await save({ ...cal, visible });
  // the backend only returns occurrences of visible calendars
  await useCalendar.getState().loadOccurrences();
}

export async function importInto(calendarId: string): Promise<void> {
  const n = await attempt(() => api.calendar.importIcs(calendarId));
  if (n) toast('success', `${n} Termin${n === 1 ? '' : 'e'} importiert`);
}

export async function exportCalendar(calendarId: string): Promise<void> {
  const path = await attempt(() => api.calendar.exportIcs(calendarId));
  if (path) toast('success', `Exportiert nach ${path}`);
}

export async function refreshCalendar(cal: Calendar): Promise<void> {
  const n = await attempt(() => api.calendar.refreshSubscription(cal.id));
  if (n !== undefined) toast('success', `„${cal.name}“ aktualisiert: ${n} Termin${n === 1 ? '' : 'e'}`);
}

export async function deleteCalendar(cal: Calendar): Promise<void> {
  if (useCalendar.getState().calendars.length <= 1) {
    toast('error', 'Der letzte Kalender kann nicht gelöscht werden.');
    return;
  }
  const ok = await confirm('Kalender löschen', `„${cal.name}“ und alle darin enthaltenen Termine werden endgültig gelöscht.`, 'Löschen', true);
  if (!ok) return;
  const done = await attempt(async () => {
    await api.calendar.removeCalendar(cal.id);
    return true;
  }, 'Kalender gelöscht');
  if (done) {
    await useCalendar.getState().loadCalendars();
    if (useCalendar.getState().activeCalendarId === cal.id) useCalendar.getState().setActiveCalendar(null);
  }
}
