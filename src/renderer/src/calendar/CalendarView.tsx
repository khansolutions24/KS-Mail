// Calendar module root: side pane, ribbon and the active view; wires data loading, commands, intents and keys.

import { useEffect, useMemo } from 'react';
import type { CalendarEvent } from '@shared/types';
import { onEvent } from '../api/client';
import { registerCommands } from '../lib/commands';
import { isTyping } from '../lib/keys';
import { useApp } from '../store/app';
import { useIntentHandler } from '../store/intent';
import { deleteOccurrence, openEventById, openNewEvent, openOccurrence } from './actions';
import { AgendaView } from './AgendaView';
import { CalendarSidebar } from './CalendarSidebar';
import { createCalendar, exportCalendar, importInto, subscribeCalendar, targetCalendarId } from './calendarOps';
import { visibleDays } from './dates';
import { EventEditor } from './EventEditor';
import { MonthView } from './MonthView';
import { SeriesDialog } from './SeriesDialog';
import { useCalSettings, useCalendar } from './store';
import { TimeGrid } from './TimeGrid';
import { Toolbar } from './Toolbar';

/** Optional prefill passed with the `newEvent` intent as JSON (e.g. "Als Termin planen" from a mail) */
function parsePrefill(arg?: string): { start?: number; end?: number; allDay?: boolean; patch: Partial<CalendarEvent> } | null {
  if (!arg) return null;
  try {
    const v: unknown = JSON.parse(arg);
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    const str = (k: string): string | undefined => (typeof o[k] === 'string' ? (o[k] as string) : undefined);
    const num = (k: string): number | undefined => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : undefined);
    const patch: Partial<CalendarEvent> = {};
    if (str('title') !== undefined) patch.title = str('title');
    if (str('notes') !== undefined) patch.notes = str('notes');
    if (str('location') !== undefined) patch.location = str('location');
    return { start: num('start'), end: num('end'), allDay: o.allDay === true, patch };
  } catch {
    return null;
  }
}

function useCalendarData(): void {
  const cs = useCalSettings();
  const view = useCalendar((s) => s.view);
  const date = useCalendar((s) => s.date);

  useEffect(() => {
    void useCalendar.getState().loadCalendars();
    let timer: number | undefined;
    const off = onEvent('calendar:changed', () => {
      // coalesce bursts (imports, series edits save several events)
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void useCalendar.getState().loadCalendars();
        void useCalendar.getState().loadOccurrences();
      }, 80);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    void useCalendar.getState().loadOccurrences();
  }, [view, date, cs.weekStart, cs.workDays]);
}

function useCalendarCommands(): void {
  useEffect(() => {
    const cal = useCalendar.getState;
    return registerCommands({
      'calendar.today': () => cal().goToday(),
      'calendar.next': () => cal().step(1),
      'calendar.prev': () => cal().step(-1),
      'calendar.viewDay': () => cal().setView('day'),
      'calendar.viewWorkweek': () => cal().setView('workweek'),
      'calendar.viewWeek': () => cal().setView('week'),
      'calendar.viewMonth': () => cal().setView('month'),
      'calendar.viewAgenda': () => cal().setView('agenda'),
      'calendar.import': () => importInto(targetCalendarId()),
      'calendar.export': () => exportCalendar(targetCalendarId()),
      'calendar.new': () => createCalendar(),
      'calendar.subscribe': () => subscribeCalendar()
    });
  }, []);

  useIntentHandler('calendar', (action, arg) => {
    if (action === 'newEvent') {
      const p = parsePrefill(arg);
      openNewEvent(p?.start, p?.end, p?.allDay, p?.patch);
    } else if (action === 'openEvent' && arg) {
      void openEventById(arg);
    }
  });
}

/** Delete removes and Enter opens the selected event (outside of inputs and dialogs) */
function useSelectionKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || isTyping(e) || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key !== 'Delete' && e.key !== 'Enter') return;
      // Enter on a focused control belongs to that control
      if (e.key === 'Enter' && (e.target as HTMLElement | null)?.closest?.('button, a, [role="tab"]')) return;
      const app = useApp.getState();
      if (app.module !== 'calendar' || app.prompt || app.confirm || app.overlay || document.querySelector('.dialog, .menu')) return;
      const { selected, occurrences } = useCalendar.getState();
      const occ = selected && occurrences.find((o) => o.event.id === selected.id && o.start === selected.start);
      if (!occ) return;
      e.preventDefault();
      if (e.key === 'Delete') void deleteOccurrence(occ.event, occ.start);
      else openOccurrence(occ);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function CalendarView(): JSX.Element {
  const cs = useCalSettings();
  const view = useCalendar((s) => s.view);
  const date = useCalendar((s) => s.date);

  // first visit: start with the configured default view
  useEffect(() => useCalendar.getState().init(cs.defaultView), [cs.defaultView]);
  useCalendarData();
  useCalendarCommands();
  useSelectionKeys();

  const days = useMemo(() => visibleDays(view, date, cs), [view, date, cs]);

  return (
    <div className="cal-module">
      <CalendarSidebar />
      <section className="pane cal-main">
        <Toolbar />
        <div className="cal-view">
          {view === 'month' ? <MonthView days={days} /> : view === 'agenda' ? <AgendaView days={days} /> : <TimeGrid days={days} />}
        </div>
      </section>
      <EventEditor />
      <SeriesDialog />
    </div>
  );
}
