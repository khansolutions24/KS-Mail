// Pure helpers for the tasks module: views, filtering, sorting, due dates and recurrence presets.

import type { Recurrence, Task } from '@shared/types';
import { newId } from '@shared/util';
import { addDays, startOfDay } from '../lib/format';

export type SmartId = 'myDay' | 'important' | 'planned' | 'all' | 'done' | 'flagged';

/** Current view: a smart list or `list:<id>` */
export type ViewId = SmartId | `list:${string}`;

export const SMART_LISTS: { id: SmartId; label: string }[] = [
  { id: 'myDay', label: 'Mein Tag' },
  { id: 'important', label: 'Wichtig' },
  { id: 'planned', label: 'Geplant' },
  { id: 'all', label: 'Alle' },
  { id: 'done', label: 'Erledigt' },
  { id: 'flagged', label: 'Gekennzeichnete E-Mails' }
];

export function listIdOf(view: ViewId): string | null {
  return view.startsWith('list:') ? view.slice(5) : null;
}

/** Whether a task belongs to a view (ignoring its done state, except for "Erledigt") */
export function inView(t: Task, view: ViewId): boolean {
  const listId = listIdOf(view);
  if (listId) return t.listId === listId;
  switch (view) {
    case 'myDay':
      return t.myDay;
    case 'important':
      return t.important;
    case 'planned':
      return t.due !== null;
    case 'all':
      return true;
    case 'done':
      return t.done;
    default:
      return false;
  }
}

export function sortOpen(tasks: Task[], view: ViewId): Task[] {
  const byDue = (a: Task, b: Task): number => (a.due ?? Infinity) - (b.due ?? Infinity);
  return [...tasks].sort((a, b) => (view === 'planned' ? byDue(a, b) || a.sortOrder - b.sortOrder : a.sortOrder - b.sortOrder || byDue(a, b)));
}

export function sortDone(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
}

export function newTask(listId: string, title: string, patch: Partial<Task> = {}): Task {
  return {
    id: newId(),
    listId,
    title,
    notes: '',
    due: null,
    reminder: null,
    priority: 'normal',
    done: false,
    important: false,
    myDay: false,
    steps: [],
    recurrence: null,
    messageId: null,
    created: Date.now(),
    completedAt: null,
    sortOrder: Date.now(),
    ...patch
  };
}

/** Attributes a task created inside a smart list gets */
export function smartDefaults(view: ViewId): Partial<Task> {
  switch (view) {
    case 'myDay':
      return { myDay: true };
    case 'important':
      return { important: true };
    case 'planned':
      return { due: startOfDay(Date.now()) };
    default:
      return {};
  }
}

export function isOverdue(t: Task): boolean {
  return !t.done && t.due !== null && startOfDay(t.due) < startOfDay(Date.now());
}

export function dueLabel(due: number): string {
  const d = startOfDay(due);
  const today = startOfDay(Date.now());
  if (d === today) return 'Heute';
  if (d === addDays(today, 1)) return 'Morgen';
  if (d === addDays(today, -1)) return 'Gestern';
  const date = new Date(due);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** Monday of next week */
export function nextWeek(): number {
  const today = startOfDay(Date.now());
  const dow = new Date(today).getDay();
  return addDays(today, ((8 - dow) % 7) || 7);
}

export type RecurrencePreset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

export const RECURRENCE_OPTIONS: { id: RecurrencePreset; label: string }[] = [
  { id: 'none', label: 'Keine Wiederholung' },
  { id: 'daily', label: 'Täglich' },
  { id: 'weekdays', label: 'Werktags (Mo–Fr)' },
  { id: 'weekly', label: 'Wöchentlich' },
  { id: 'monthly', label: 'Monatlich' },
  { id: 'yearly', label: 'Jährlich' }
];

export function presetOf(r: Recurrence | null): RecurrencePreset | 'custom' {
  if (!r) return 'none';
  if (r.interval !== 1 || r.count || r.until) return 'custom';
  switch (r.freq) {
    case 'DAILY':
      return 'daily';
    case 'WEEKLY': {
      const days = [...(r.byDay ?? [])].sort().join(',');
      if (days === '1,2,3,4,5') return 'weekdays';
      return days.length <= 1 ? 'weekly' : 'custom';
    }
    case 'MONTHLY':
      return 'monthly';
    case 'YEARLY':
      return 'yearly';
  }
}

export function recurrenceFor(p: RecurrencePreset): Recurrence | null {
  switch (p) {
    case 'none':
      return null;
    case 'daily':
      return { freq: 'DAILY', interval: 1 };
    case 'weekdays':
      return { freq: 'WEEKLY', interval: 1, byDay: [1, 2, 3, 4, 5] };
    case 'weekly':
      return { freq: 'WEEKLY', interval: 1 };
    case 'monthly':
      return { freq: 'MONTHLY', interval: 1 };
    case 'yearly':
      return { freq: 'YEARLY', interval: 1 };
  }
}

export const PRIORITY_LABELS: Record<Task['priority'], string> = { low: 'Niedrig', normal: 'Normal', high: 'Hoch' };
