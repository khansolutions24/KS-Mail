// Calendar module state: current view/date (kept across module switches), calendars, loaded occurrences,
// selection, the open editor and the "occurrence or series?" question.

import { create } from 'zustand';
import type { Calendar, CalendarEvent, EventOccurrence } from '@shared/types';
import { api, errorMessage } from '../api/client';
import { toast, useApp } from '../store/app';
import { startOfDay } from '../lib/format';
import { fallbackCalSettings, stepDate, visibleRange, type CalSettings, type CalView } from './dates';

export interface Selection {
  id: string;
  /** Occurrence start (identifies one occurrence of a recurring series) */
  start: number;
}

export interface EditorState {
  /** Working copy; for an occurrence of a series start/end are the occurrence's times */
  event: CalendarEvent;
  /** Stored event as loaded (null = new event) */
  original: CalendarEvent | null;
  /** Start of the occurrence the editor was opened from (recurring series only) */
  occurrenceStart?: number;
}

export type SeriesChoice = 'one' | 'series';

export interface SeriesQuestion {
  title: string;
  text: string;
  resolve: (choice: SeriesChoice | null) => void;
}

interface CalendarState {
  initialized: boolean;
  view: CalView;
  date: number;
  calendars: Calendar[];
  occurrences: EventOccurrence[];
  loading: boolean;
  selected: Selection | null;
  editor: EditorState | null;
  series: SeriesQuestion | null;
  /** Calendar used by import/export commands (last one clicked in the side pane) */
  activeCalendarId: string | null;

  init(view: CalView): void;
  setView(view: CalView): void;
  setDate(date: number): void;
  goToday(): void;
  step(dir: 1 | -1): void;
  select(sel: Selection | null): void;
  openEditor(state: EditorState): void;
  closeEditor(): void;
  setActiveCalendar(id: string | null): void;
  loadCalendars(): Promise<void>;
  loadOccurrences(): Promise<void>;
  /** Optimistically replaces one occurrence while the backend saves */
  patchOccurrence(sel: Selection, start: number, end: number): void;
}

let loadSeq = 0;

export const useCalendar = create<CalendarState>((set, get) => ({
  initialized: false,
  view: 'workweek',
  date: startOfDay(Date.now()),
  calendars: [],
  occurrences: [],
  loading: false,
  selected: null,
  editor: null,
  series: null,
  activeCalendarId: null,

  init: (view) => {
    if (!get().initialized) set({ initialized: true, view });
  },
  setView: (view) => set({ view }),
  setDate: (date) => set({ date: startOfDay(date) }),
  goToday: () => set({ date: startOfDay(Date.now()) }),
  step: (dir) => set({ date: stepDate(get().view, get().date, dir) }),
  select: (selected) => set({ selected }),
  openEditor: (editor) => set({ editor }),
  closeEditor: () => set({ editor: null }),
  setActiveCalendar: (activeCalendarId) => set({ activeCalendarId }),

  loadCalendars: async () => {
    try {
      set({ calendars: await api.calendar.calendars() });
    } catch (err) {
      toast('error', errorMessage(err));
    }
  },

  loadOccurrences: async () => {
    const { view, date } = get();
    const { from, to } = visibleRange(view, date, calSettings());
    const seq = ++loadSeq;
    set({ loading: true });
    try {
      const occurrences = await api.calendar.occurrences(from, to);
      // ignore responses of requests that were superseded by a newer range
      if (seq === loadSeq) set({ occurrences, loading: false });
    } catch (err) {
      if (seq === loadSeq) set({ loading: false });
      toast('error', errorMessage(err));
    }
  },

  patchOccurrence: (sel, start, end) =>
    set({
      occurrences: get().occurrences.map((o) => (o.event.id === sel.id && o.start === sel.start ? { ...o, start, end } : o)),
      selected: get().selected && get().selected!.id === sel.id && get().selected!.start === sel.start ? { id: sel.id, start } : get().selected
    })
}));

const FALLBACK_SETTINGS = fallbackCalSettings();

/** Calendar settings with defaults when settings are not loaded (yet) */
export function calSettings(): CalSettings {
  return useApp.getState().settings?.calendar ?? FALLBACK_SETTINGS;
}

export function useCalSettings(): CalSettings {
  return useApp((s) => s.settings?.calendar) ?? FALLBACK_SETTINGS;
}

/** Asks whether a change applies to one occurrence or to the whole series */
export function askSeries(title: string, text = 'Möchten Sie nur dieses Vorkommen oder die ganze Serie ändern?'): Promise<SeriesChoice | null> {
  return new Promise((resolve) => useCalendar.setState({ series: { title, text, resolve } }));
}

export function calendarById(id: string): Calendar | undefined {
  return useCalendar.getState().calendars.find((c) => c.id === id);
}

export function isReadOnly(ev: CalendarEvent): boolean {
  return !!calendarById(ev.calendarId)?.subscriptionUrl;
}

export function occurrenceKey(o: { event: { id: string }; start: number }): string {
  return `${o.event.id}@${o.start}`;
}
