// Month view: 6-week grid, events as lanes per week row, "+X weitere", drag between days.

import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Calendar, EventOccurrence } from '@shared/types';
import { isoWeek, startOfDay, time } from '../lib/format';
import { openNewEvent, openOccurrence } from './actions';
import { isAllDayLike } from './AllDayRow';
import { applyDayDrag, useDayDrag, type DayDrag } from './dayDrag';
import { WEEKDAY_SHORT, workDaysOf } from './dates';
import { EventIcons, EventMenu, eventClasses, eventColorStyle } from './EventParts';
import { daySpan, packLanes } from './layout';
import { occurrenceKey, useCalSettings, useCalendar, type Selection } from './store';
import { useNow } from './useNow';

const HEAD_PX = 26;
const LANE_PX = 22;
const MORE_PX = 20;

interface Bar {
  key: string;
  orig: EventOccurrence;
  occ: EventOccurrence;
  from: number;
  to: number;
  lane: number;
}

export function MonthView({ days }: { days: number[] }): JSX.Element {
  const cs = useCalSettings();
  const date = useCalendar((s) => s.date);
  const occurrences = useCalendar((s) => s.occurrences);
  const calendarList = useCalendar((s) => s.calendars);
  const selected = useCalendar((s) => s.selected);
  const today = startOfDay(useNow());
  const calendars = useMemo(() => new Map(calendarList.map((c) => [c.id, c])), [calendarList]);
  const workDays = useMemo(() => new Set(workDaysOf(cs)), [cs]);
  const { drag, begin } = useDayDrag();

  // how many lanes fit into a week row
  const bodyRef = useRef<HTMLDivElement>(null);
  const [maxLanes, setMaxLanes] = useState(3);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rowH = el.clientHeight / 6;
      setMaxLanes(Math.max(1, Math.floor((rowH - HEAD_PX - MORE_PX) / LANE_PX)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const weeks = useMemo(() => Array.from({ length: 6 }, (_, w) => days.slice(w * 7, w * 7 + 7)), [days]);
  const month = new Date(date).getMonth();
  const shown = useMemo(() => applyDayDrag(occurrences, drag), [occurrences, drag]);
  const weekdayNames = weeks[0].map((d) => WEEKDAY_SHORT[new Date(d).getDay()]);

  return (
    <div className={clsx('cal-month', cs.showWeekNumbers && 'with-weeks', drag && 'dragging')}>
      <div className="cal-month-head">
        {cs.showWeekNumbers && <span className="cal-month-kwhead">KW</span>}
        <div className="cal-month-wds">
          {weekdayNames.map((n, i) => (
            <span key={i}>{n}</span>
          ))}
        </div>
      </div>
      <div className="cal-month-body" ref={bodyRef}>
        {weeks.map((week) => (
          <Week
            key={week[0]}
            week={week}
            occs={occurrences}
            shown={shown}
            month={month}
            today={today}
            workDays={workDays}
            maxLanes={maxLanes}
            showWeekNumber={cs.showWeekNumbers}
            calendars={calendars}
            selected={selected}
            drag={drag}
            begin={begin}
          />
        ))}
      </div>
    </div>
  );
}

function Week({
  week,
  occs,
  shown,
  month,
  today,
  workDays,
  maxLanes,
  showWeekNumber,
  calendars,
  selected,
  drag,
  begin
}: {
  week: number[];
  occs: EventOccurrence[];
  shown: EventOccurrence[];
  month: number;
  today: number;
  workDays: Set<number>;
  maxLanes: number;
  showWeekNumber: boolean;
  calendars: Map<string, Calendar>;
  selected: Selection | null;
  drag: DayDrag | null;
  begin: (e: React.PointerEvent, o: EventOccurrence) => void;
}): JSX.Element {
  const { setDate, setView, select } = useCalendar.getState();

  const { bars, hidden } = useMemo(() => {
    const items = shown.flatMap((o, i) => {
      const span = daySpan(week, o.start, o.end);
      return span ? [{ key: occurrenceKey(occs[i]), orig: occs[i], occ: o, ...span }] : [];
    });
    // bars (all-day / multi-day) first, then timed events by start time
    items.sort((a, b) => Number(isAllDayLike(b.occ)) - Number(isAllDayLike(a.occ)) || a.occ.start - b.occ.start);
    const lanes = packLanes(items);
    const all: Bar[] = items.map((b) => ({ ...b, lane: lanes.get(b.key) ?? 0 }));
    const hiddenPerDay = week.map((_, d) => all.filter((b) => b.lane >= maxLanes && b.from <= d && d < b.to).length);
    return { bars: all.filter((b) => b.lane < maxLanes), hidden: hiddenPerDay };
  }, [shown, occs, week, maxLanes]);

  const openDay = (d: number): void => {
    setDate(d);
    setView('day');
  };

  return (
    <div className="cal-week">
      {showWeekNumber && <span className="cal-week-kw">{isoWeek(week[0])}</span>}
      <div className="cal-week-area">
        <div className="cal-week-cells">
          {week.map((d, i) => (
            <div
              key={d}
              data-day={d}
              className={clsx('cal-mcell', new Date(d).getMonth() !== month && 'other', !workDays.has(new Date(d).getDay()) && 'weekend', d === today && 'today', drag?.target === d && 'drop-target')}
              onClick={() => select(null)}
              onDoubleClick={() => openNewEvent(d, undefined, true)}
            >
              <button
                className="cal-mcell-num"
                onClick={(e) => {
                  e.stopPropagation();
                  openDay(d);
                }}
                onDoubleClick={(e) => e.stopPropagation()}
                title="Tagesansicht öffnen"
              >
                {new Date(d).getDate() === 1 ? new Date(d).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' }) : new Date(d).getDate()}
              </button>
              {hidden[i] > 0 && (
                <button
                  className="cal-more"
                  style={{ top: HEAD_PX + maxLanes * LANE_PX }}
                  onClick={(e) => {
                    e.stopPropagation();
                    openDay(d);
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  +{hidden[i]} weitere
                </button>
              )}
            </div>
          ))}
        </div>
        {bars.map((b) => {
          const o = b.occ;
          const asBar = isAllDayLike(o) || b.to - b.from > 1;
          const isSel = !!selected && selected.id === o.event.id && selected.start === b.orig.start;
          return (
            <EventMenu key={b.key} occ={b.orig}>
              <div
                className={clsx(eventClasses(o.event, isSel), asBar ? 'cal-bar' : 'cal-item', drag?.key === b.key && 'is-dragging', o.start < week[b.from] && 'cut-left')}
                style={{
                  ...eventColorStyle(o.event, calendars),
                  top: HEAD_PX + b.lane * LANE_PX,
                  left: `calc(${(b.from / 7) * 100}% + 3px)`,
                  width: `calc(${((b.to - b.from) / 7) * 100}% - 6px)`
                }}
                title={`${o.event.title}${o.event.allDay ? '' : `\n${time(o.start)}–${time(o.end)}`}${o.event.location ? '\n' + o.event.location : ''}`}
                onPointerDown={(e) => begin(e, b.orig)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  openOccurrence(b.orig);
                }}
              >
                {!asBar && <span className="cal-item-dot" />}
                {!o.event.allDay && <span className="cal-item-time">{time(o.start)}</span>}
                <span className="cal-ev-title ellipsis">{o.event.title}</span>
                <EventIcons ev={o.event} />
              </div>
            </EventMenu>
          );
        })}
      </div>
    </div>
  );
}
