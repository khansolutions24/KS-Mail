// Date helpers specific to the calendar views: visible days per view, navigation steps, range titles.

import type { Settings } from '@shared/types';
import { defaultSettings } from '@shared/defaults';
import { addDays, startOfDay, startOfMonth, startOfWeek } from '../lib/format';

export type CalView = Settings['calendar']['defaultView'];
export type CalSettings = Settings['calendar'];

export const DAY_MS = 86400000;
export const MINUTE_MS = 60000;
/** Number of days shown by the agenda view */
export const AGENDA_DAYS = 30;

export const VIEW_LABELS: Record<CalView, string> = {
  day: 'Tag',
  workweek: 'Arbeitswoche',
  week: 'Woche',
  month: 'Monat',
  agenda: 'Agenda'
};

export const WEEKDAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export function fallbackCalSettings(): CalSettings {
  return defaultSettings().calendar;
}

/** "HH:MM" → minutes since midnight */
export function parseHm(s: string, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return fallback;
  return Math.min(1440, Number(m[1]) * 60 + Number(m[2]));
}

/** Timestamp of `day` (a day start) plus `minutes`, DST-safe (uses local wall-clock time) */
export function atMinutes(day: number, minutes: number): number {
  const d = new Date(day);
  d.setHours(0, minutes, 0, 0);
  return d.getTime();
}

/** Minutes since local midnight of `t` */
export function minutesOfDay(t: number): number {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
}

/** Whole days between two day starts (rounded, so DST shifts do not matter) */
export function dayDiff(a: number, b: number): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

export function workDaysOf(cs: CalSettings): number[] {
  return cs.workDays.length ? cs.workDays : [1, 2, 3, 4, 5];
}

/** Day starts that the given view shows around `date` */
export function visibleDays(view: CalView, date: number, cs: CalSettings): number[] {
  const day = startOfDay(date);
  switch (view) {
    case 'day':
      return [day];
    case 'week':
    case 'workweek': {
      const first = startOfWeek(day, cs.weekStart);
      const all = Array.from({ length: 7 }, (_, i) => addDays(first, i));
      if (view === 'week') return all;
      const work = new Set(workDaysOf(cs));
      const days = all.filter((d) => work.has(new Date(d).getDay()));
      // on a weekend after the last work day, show the coming work week (like Outlook)
      if (days.length && day > days[days.length - 1]) return days.map((d) => addDays(d, 7));
      return days;
    }
    case 'month': {
      const first = startOfWeek(startOfMonth(day), cs.weekStart);
      return Array.from({ length: 42 }, (_, i) => addDays(first, i));
    }
    case 'agenda':
      return Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(day, i));
  }
}

/** [from, to) that must be loaded for the view */
export function visibleRange(view: CalView, date: number, cs: CalSettings): { from: number; to: number } {
  const days = visibleDays(view, date, cs);
  if (view === 'workweek') {
    // load the whole week so that switching views or dragging to hidden days never shows stale data
    const first = startOfWeek(days[0] ?? date, cs.weekStart);
    return { from: first, to: addDays(first, 7) };
  }
  return { from: days[0], to: addDays(days[days.length - 1], 1) };
}

/** Next / previous anchor date for the ‹ › buttons */
export function stepDate(view: CalView, date: number, dir: 1 | -1): number {
  switch (view) {
    case 'day':
      return addDays(date, dir);
    case 'week':
    case 'workweek':
      return addDays(date, 7 * dir);
    case 'month': {
      const d = new Date(startOfMonth(date));
      d.setMonth(d.getMonth() + dir);
      // keep the day of month where possible (clamped to the month length)
      const wanted = new Date(date).getDate();
      const len = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(wanted, len));
      return d.getTime();
    }
    case 'agenda':
      return addDays(date, AGENDA_DAYS * dir);
  }
}

const fmt = (t: number, o: Intl.DateTimeFormatOptions): string => new Date(t).toLocaleDateString('de-DE', o);

/** Human readable title for a range of days, e.g. "22.–26. September 2026" */
export function rangeTitle(view: CalView, date: number, cs: CalSettings): string {
  if (view === 'month') return fmt(date, { month: 'long', year: 'numeric' });
  if (view === 'day') return fmt(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const days = visibleDays(view, date, cs);
  return spanTitle(days[0], days[days.length - 1]);
}

export function spanTitle(first: number, last: number): string {
  const a = new Date(first);
  const b = new Date(last);
  if (a.getFullYear() !== b.getFullYear()) return `${fmt(first, { day: 'numeric', month: 'long', year: 'numeric' })} – ${fmt(last, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  if (a.getMonth() !== b.getMonth()) return `${fmt(first, { day: 'numeric', month: 'long' })} – ${fmt(last, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  if (a.getDate() === b.getDate()) return fmt(first, { day: 'numeric', month: 'long', year: 'numeric' });
  return `${a.getDate()}.–${fmt(last, { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

/** Rounds `t` up to the next multiple of `step` minutes (local time) */
export function ceilToMinutes(t: number, step: number): number {
  const day = startOfDay(t);
  const m = (t - day) / MINUTE_MS;
  return atMinutes(day, Math.ceil(m / step) * step);
}

/** Rounds to the nearest multiple of `step` minutes (local time of the day containing `t`) */
export function roundToMinutes(t: number, step: number): number {
  const day = startOfDay(t);
  const m = (t - day) / MINUTE_MS;
  return atMinutes(day, Math.round(m / step) * step);
}
