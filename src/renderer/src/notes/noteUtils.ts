// Note colors and date helpers.

import type { Note } from '@shared/types';
import { newId } from '@shared/util';

export const NOTE_COLORS = [
  { id: 'yellow', label: 'Gelb' },
  { id: 'green', label: 'Grün' },
  { id: 'pink', label: 'Rosa' },
  { id: 'purple', label: 'Lila' },
  { id: 'blue', label: 'Blau' },
  { id: 'gray', label: 'Grau' }
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number]['id'];

/** Normalizes stored colors (unknown values fall back to yellow) */
export function noteColor(n: Note): NoteColor {
  return NOTE_COLORS.some((c) => c.id === n.color) ? (n.color as NoteColor) : 'yellow';
}

export function emptyNote(color: NoteColor = 'yellow'): Note {
  return { id: newId(), title: '', body: '', color, updated: Date.now() };
}

export function isBlank(n: Note): boolean {
  return !n.title.trim() && !n.body.trim();
}

/** Title shown on the card: explicit title or the first line of the body */
export function noteHeading(n: Note): string {
  return n.title.trim() || n.body.trim().split('\n')[0] || 'Neue Notiz';
}

const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });

export function relativeDate(t: number, now = Date.now()): string {
  const diff = t - now;
  const abs = Math.abs(diff);
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (abs < min) return 'Gerade eben';
  if (abs < hour) return rtf.format(Math.round(diff / min), 'minute');
  if (abs < day) return rtf.format(Math.round(diff / hour), 'hour');
  if (abs < 7 * day) return rtf.format(Math.round(diff / day), 'day');
  const d = new Date(t);
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', ...(d.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }) });
}

export function matchesNote(n: Note, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const hay = `${n.title}\n${n.body}`.toLowerCase();
  return s.split(/\s+/).every((p) => hay.includes(p));
}
