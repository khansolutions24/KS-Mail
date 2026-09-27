// Small shared pieces for rendering events in the different views.

import { ExternalLink, FolderOpen, Lock, Repeat, Trash2, Users } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Calendar, CalendarEvent, EventOccurrence } from '@shared/types';
import { api } from '../api/client';
import { attempt } from '../store/app';
import { ContextMenu, type MenuEntry } from '../components/ui';
import { time } from '../lib/format';
import { deleteOccurrence, openOccurrence } from './actions';
import { useCalendar } from './store';

export const SHOW_AS_LABELS: Record<CalendarEvent['showAs'], string> = {
  busy: 'Beschäftigt',
  free: 'Frei',
  tentative: 'Mit Vorbehalt',
  oof: 'Abwesend'
};

/** Inline style carrying the event color as CSS variable (--ev) for the stylesheet */
export function eventColorStyle(ev: CalendarEvent, calendars: Map<string, Calendar>): CSSProperties {
  return { ['--ev' as string]: calendars.get(ev.calendarId)?.color ?? 'var(--accent)' };
}

export function timeRange(o: EventOccurrence): string {
  return o.end > o.start ? `${time(o.start)}–${time(o.end)}` : time(o.start);
}

export function EventIcons({ ev }: { ev: CalendarEvent }): JSX.Element | null {
  if (!ev.recurrence && !ev.isPrivate && !ev.attendees.length) return null;
  return (
    <span className="cal-ev-icons">
      {ev.recurrence && <Repeat size={11} aria-label="Serie" />}
      {ev.attendees.length > 0 && <Users size={11} aria-label="Besprechung" />}
      {ev.isPrivate && <Lock size={11} aria-label="Privat" />}
    </span>
  );
}

function menuFor(o: EventOccurrence): MenuEntry[] {
  const items: MenuEntry[] = [{ label: 'Öffnen', icon: <FolderOpen size={16} />, onSelect: () => openOccurrence(o) }];
  if (o.event.onlineMeetingUrl) {
    items.push({ label: 'Online-Besprechung beitreten', icon: <ExternalLink size={16} />, onSelect: () => void attempt(() => api.app.openExternal(o.event.onlineMeetingUrl)) });
  }
  items.push({ separator: true }, { label: 'Löschen', icon: <Trash2 size={16} />, danger: true, shortcut: 'Entf', onSelect: () => void deleteOccurrence(o.event, o.start) });
  return items;
}

/** Wraps an event element with its context menu */
export function EventMenu({ occ, children }: { occ: EventOccurrence; children: JSX.Element }): JSX.Element {
  return (
    <ContextMenu items={() => menuFor(occ)} onOpen={() => useCalendar.getState().select({ id: occ.event.id, start: occ.start })}>
      {children}
    </ContextMenu>
  );
}

/** CSS classes describing the "show as" state and selection */
export function eventClasses(ev: CalendarEvent, selected: boolean): string {
  return ['cal-ev', `show-${ev.showAs}`, selected ? 'selected' : ''].filter(Boolean).join(' ');
}
