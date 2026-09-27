// Event operations shared by all views: create drafts, open, move/resize, delete and save (with the
// "only this occurrence or the whole series?" handling for recurring events).

import type { CalendarEvent, EventOccurrence, Recurrence } from '@shared/types';
import { expandEvent } from '@shared/recurrence';
import { newId } from '@shared/util';
import { api, errorMessage } from '../api/client';
import { attempt, toast } from '../store/app';
import { addDays, startOfDay } from '../lib/format';
import { atMinutes, ceilToMinutes, dayDiff, DAY_MS, MINUTE_MS, minutesOfDay } from './dates';
import { askSeries, calSettings, isReadOnly, isWritableCalendar, useCalendar, type EditorState } from './store';

export const UNTITLED = '(Ohne Titel)';
const READ_ONLY_MSG = 'Abonnierte Internetkalender sind schreibgeschützt.';

/** Calendar for new events: the configured default, else the first writable one */
export function defaultCalendarId(): string {
  const cals = useCalendar.getState().calendars;
  const wanted = calSettings().defaultCalendarId;
  if (!cals.length) return wanted ?? 'default'; // calendars not loaded yet
  const writable = cals.filter(isWritableCalendar);
  return (writable.find((c) => c.id === wanted) ?? writable[0] ?? cals[0]).id;
}

/** A new, unsaved event. Without `end` the default duration (timed) or one day (all-day) is used. */
export function newEventDraft(start: number, end?: number, allDay = false, patch: Partial<CalendarEvent> = {}): CalendarEvent {
  const cs = calSettings();
  const s = allDay ? startOfDay(start) : start;
  const e = end ?? (allDay ? addDays(s, 1) : s + cs.defaultDuration * MINUTE_MS);
  return {
    id: '',
    calendarId: defaultCalendarId(),
    uid: '',
    title: '',
    location: '',
    notes: '',
    start: s,
    end: Math.max(s, e),
    allDay,
    recurrence: null,
    exdates: [],
    reminder: cs.defaultReminder,
    showAs: allDay ? 'free' : 'busy',
    organizer: null,
    attendees: [],
    categories: [],
    isPrivate: false,
    onlineMeetingUrl: '',
    updated: 0,
    ...patch
  };
}

/** Opens the editor for a new event; defaults to the next half hour of the currently shown day */
export function openNewEvent(start?: number, end?: number, allDay = false, patch?: Partial<CalendarEvent>): void {
  let s = start;
  if (s === undefined) {
    const now = Date.now();
    const shown = useCalendar.getState().date;
    const base = startOfDay(shown) === startOfDay(now) ? now : atMinutes(shown, 9 * 60);
    s = ceilToMinutes(base, 30);
  }
  useCalendar.getState().openEditor({ event: newEventDraft(s, end, allDay, patch), original: null });
}

export function openOccurrence(o: EventOccurrence): void {
  const cal = useCalendar.getState();
  cal.select({ id: o.event.id, start: o.start });
  cal.openEditor({
    event: { ...o.event, start: o.start, end: o.end },
    original: o.event,
    occurrenceStart: o.event.recurrence ? o.start : undefined
  });
}

/** Navigates to an event (next occurrence for series) and opens it */
export async function openEventById(id: string): Promise<void> {
  const ev = await attempt(() => api.calendar.get(id));
  if (!ev) {
    if (ev === null) toast('error', 'Der Termin wurde nicht gefunden.');
    return;
  }
  let occ: EventOccurrence = { event: ev, start: ev.start, end: ev.end };
  if (ev.recurrence) {
    const today = startOfDay(Date.now());
    occ = expandEvent(ev, today, today + 400 * DAY_MS)[0] ?? expandEvent(ev, ev.start, ev.start + 1)[0] ?? occ;
  }
  const cal = useCalendar.getState();
  cal.setDate(occ.start);
  openOccurrence(occ);
}

function sameRule(a: Recurrence | null, b: Recurrence | null): boolean {
  if (!a || !b) return a === b;
  const norm = (r: Recurrence): string =>
    JSON.stringify([r.freq, r.interval || 1, [...(r.byDay ?? [])].sort(), r.count ?? null, r.until ?? null]);
  return norm(a) === norm(b);
}

/**
 * Moves a whole series so that the occurrence at `occStart` lands on [newStart, newEnd).
 * The shift is applied in wall-clock days + minutes (DST safe) to the series start, its exception
 * dates and (optionally) the end date; weekly weekday rules are rotated by the day shift.
 */
export function shiftSeries(ev: CalendarEvent, occStart: number, newStart: number, newEnd: number, shiftUntil = true): CalendarEvent {
  const days = dayDiff(occStart, newStart);
  const minutes = ev.allDay ? 0 : minutesOfDay(newStart) - minutesOfDay(occStart);
  const shift = (t: number): number => atMinutes(addDays(startOfDay(t), days), minutesOfDay(t) + minutes);
  const start = shift(ev.start);
  const end = ev.allDay ? addDays(start, Math.max(1, dayDiff(newStart, newEnd))) : start + (newEnd - newStart);
  let recurrence = ev.recurrence;
  if (recurrence) {
    const dayShift = dayDiff(ev.start, start);
    recurrence = {
      ...recurrence,
      byDay: recurrence.byDay?.map((d) => (((d + dayShift) % 7) + 7) % 7),
      until: shiftUntil && recurrence.until != null ? recurrence.until + (start - ev.start) : recurrence.until
    };
  }
  return { ...ev, start, end, recurrence, exdates: ev.exdates.map(shift) };
}

/** Removes one occurrence from a series and stores it as a separate single event with `patch` applied */
async function detachOccurrence(series: CalendarEvent, occStart: number, patch: Partial<CalendarEvent>): Promise<CalendarEvent> {
  await api.calendar.save({ ...series, exdates: [...series.exdates, occStart] });
  return api.calendar.save({ ...series, ...patch, id: newId(), uid: `${newId()}@ksmail`, recurrence: null, exdates: [] });
}

/** Commits a drag move / resize of an occurrence */
export async function moveOccurrence(o: EventOccurrence, start: number, end: number): Promise<void> {
  const ev = o.event;
  if (start === o.start && end === o.end) return;
  if (isReadOnly(ev)) {
    toast('error', READ_ONLY_MSG);
    return;
  }
  try {
    if (ev.recurrence) {
      const choice = await askSeries('Serientermin ändern');
      if (!choice) return;
      useCalendar.getState().patchOccurrence({ id: ev.id, start: o.start }, start, end);
      if (choice === 'one') {
        const copy = await detachOccurrence(ev, o.start, { start, end });
        useCalendar.getState().select({ id: copy.id, start: copy.start });
      } else {
        await api.calendar.save(shiftSeries(ev, o.start, start, end));
      }
    } else {
      useCalendar.getState().patchOccurrence({ id: ev.id, start: o.start }, start, end);
      await api.calendar.save({ ...ev, start, end });
    }
  } catch (err) {
    toast('error', errorMessage(err));
    void useCalendar.getState().loadOccurrences();
  }
}

/** Deletes an occurrence (asks for recurring events) with an undo toast */
export async function deleteOccurrence(ev: CalendarEvent, occStart: number): Promise<boolean> {
  if (isReadOnly(ev)) {
    toast('error', READ_ONLY_MSG);
    return false;
  }
  let onlyOne = false;
  if (ev.recurrence) {
    const choice = await askSeries('Serientermin löschen', 'Möchten Sie nur dieses Vorkommen oder die ganze Serie löschen?');
    if (!choice) return false;
    onlyOne = choice === 'one';
  }
  try {
    await api.calendar.remove(ev.id, onlyOne ? occStart : undefined);
  } catch (err) {
    toast('error', errorMessage(err));
    return false;
  }
  useCalendar.getState().select(null);
  toast('info', onlyOne ? 'Vorkommen gelöscht' : ev.recurrence ? 'Serie gelöscht' : 'Termin gelöscht', {
    label: 'Rückgängig',
    run: () => void attempt(() => api.calendar.save(ev))
  });
  return true;
}

/**
 * Saves the editor's working copy. Returns the stored event, or null when cancelled / failed.
 * `inviteFrom` = account id to send meeting requests from after saving.
 */
export async function saveFromEditor(state: EditorState, draft: CalendarEvent, inviteFrom?: string): Promise<CalendarEvent | null> {
  const ev: CalendarEvent = { ...draft, title: draft.title.trim() || UNTITLED, end: Math.max(draft.start, draft.end) };
  const { original, occurrenceStart } = state;
  try {
    let saved: CalendarEvent;
    if (original?.recurrence && occurrenceStart !== undefined) {
      const unchangedRule = sameRule(original.recurrence, ev.recurrence);
      // the question only makes sense while the rule itself is unchanged
      const choice = unchangedRule ? await askSeries('Serientermin bearbeiten') : 'series';
      if (!choice) return null;
      if (choice === 'one') {
        saved = await detachOccurrence(original, occurrenceStart, { ...ev, exdates: [] });
      } else {
        const series = { ...ev, start: original.start, end: original.end, exdates: original.exdates, recurrence: ev.recurrence };
        saved = await api.calendar.save(shiftSeries(series, occurrenceStart, ev.start, ev.end, unchangedRule));
      }
    } else {
      saved = await api.calendar.save(ev);
    }
    if (inviteFrom && saved.attendees.length) {
      await api.calendar.sendInvites(saved.id, inviteFrom);
      toast('success', 'Einladungen wurden gesendet');
    }
    return saved;
  } catch (err) {
    toast('error', errorMessage(err));
    return null;
  }
}
