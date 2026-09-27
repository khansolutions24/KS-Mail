// Agenda: the next 30 days as a list grouped by day.

import clsx from 'clsx';
import { CalendarX2, MapPin, Video } from 'lucide-react';
import { useMemo } from 'react';
import { describeRecurrence } from '@shared/recurrence';
import { addDays, startOfDay, time } from '../lib/format';
import { Empty } from '../components/ui';
import { openNewEvent, openOccurrence } from './actions';
import { EventIcons, EventMenu, eventClasses, eventColorStyle, SHOW_AS_LABELS } from './EventParts';
import { occurrenceKey, useCalendar } from './store';
import { useNow } from './useNow';

export function AgendaView({ days }: { days: number[] }): JSX.Element {
  const occurrences = useCalendar((s) => s.occurrences);
  const calendarList = useCalendar((s) => s.calendars);
  const selected = useCalendar((s) => s.selected);
  const select = useCalendar((s) => s.select);
  const today = startOfDay(useNow());
  const calendars = useMemo(() => new Map(calendarList.map((c) => [c.id, c])), [calendarList]);

  // multi-day events appear on every day they cover
  const groups = useMemo(
    () =>
      days
        .map((day) => {
          const end = addDays(day, 1);
          const items = occurrences
            .filter((o) => o.start < end && (o.end > day || (o.end === o.start && o.start >= day)))
            .sort((a, b) => Number(b.event.allDay) - Number(a.event.allDay) || a.start - b.start);
          return { day, items };
        })
        .filter((g) => g.items.length),
    [days, occurrences]
  );

  if (!groups.length) {
    return (
      <div className="cal-agenda">
        <Empty icon={<CalendarX2 size={48} />} title="Keine Termine in den nächsten 30 Tagen">
          <button className="btn" onClick={() => openNewEvent()}>
            Neuer Termin
          </button>
        </Empty>
      </div>
    );
  }

  return (
    <div className="cal-agenda">
      {groups.map(({ day, items }) => (
        <section key={day} className="cal-agenda-day">
          <h3 className={clsx('cal-agenda-date', day === today && 'today')}>
            <span className="cal-agenda-num">{new Date(day).getDate()}</span>
            <span>
              {day === today ? 'Heute · ' : day === addDays(today, 1) ? 'Morgen · ' : ''}
              {new Date(day).toLocaleDateString('de-DE', { weekday: 'long', month: 'long', year: 'numeric' })}
            </span>
          </h3>
          {items.map((o) => {
            const ev = o.event;
            const cal = calendars.get(ev.calendarId);
            const dayEnd = addDays(day, 1);
            const when = ev.allDay
              ? 'Ganztägig'
              : `${o.start < day ? '…' : time(o.start)} – ${o.end > dayEnd ? '…' : time(o.end)}`;
            const isSel = !!selected && selected.id === ev.id && selected.start === o.start;
            return (
              <EventMenu key={occurrenceKey(o)} occ={o}>
                <div
                  className={clsx(eventClasses(ev, isSel), 'cal-agenda-item')}
                  style={eventColorStyle(ev, calendars)}
                  onClick={() => select({ id: ev.id, start: o.start })}
                  onDoubleClick={() => openOccurrence(o)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      openOccurrence(o);
                    }
                  }}
                >
                  <span className="cal-agenda-when">{when}</span>
                  <span className="cal-agenda-bar" />
                  <div className="cal-agenda-main">
                    <div className="cal-agenda-title">
                      <span className="ellipsis">{ev.title}</span>
                      <EventIcons ev={ev} />
                    </div>
                    <div className="cal-agenda-meta muted">
                      {ev.location && (
                        <span>
                          <MapPin size={12} /> {ev.location}
                        </span>
                      )}
                      {ev.onlineMeetingUrl && (
                        <span>
                          <Video size={12} /> Online-Besprechung
                        </span>
                      )}
                      {ev.recurrence && <span>{describeRecurrence(ev.recurrence)}</span>}
                      {ev.attendees.length > 0 && <span>{ev.attendees.length} Teilnehmer</span>}
                      {ev.showAs !== 'busy' && <span>{SHOW_AS_LABELS[ev.showAs]}</span>}
                    </div>
                  </div>
                  {cal && (
                    <span className="cal-agenda-cal">
                      <span className="color-dot" style={{ background: cal.color }} />
                      {cal.name}
                    </span>
                  )}
                </div>
              </EventMenu>
            );
          })}
        </section>
      ))}
    </div>
  );
}
