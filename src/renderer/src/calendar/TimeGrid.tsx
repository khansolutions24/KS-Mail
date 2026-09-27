// Day / work week / week view: all-day row plus a 24h time grid with overlap layout, current time
// line, drag-to-create, drag-to-move and resize.

import clsx from 'clsx';
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { Calendar, EventOccurrence } from '@shared/types';
import { addDays, isoWeek, startOfDay } from '../lib/format';
import { openOccurrence } from './actions';
import { AllDayRow, isAllDayLike } from './AllDayRow';
import { minutesOfDay, MINUTE_MS, parseHm, WEEKDAY_SHORT, workDaysOf } from './dates';
import { EventIcons, EventMenu, eventClasses, eventColorStyle, timeRange } from './EventParts';
import { useGridDrag, type GridDrag } from './gridDrag';
import { packColumns } from './layout';
import { occurrenceKey, useCalSettings, useCalendar, type Selection } from './store';
import { useNow } from './useNow';

/** Height of one slot in px per time scale */
const SLOT_PX: Record<15 | 30 | 60, number> = { 15: 20, 30: 24, 60: 44 };
/** Events shorter than this many px are rendered compact (single line) */
const COMPACT_PX = 38;

interface Shown {
  /** Key of the unmodified occurrence (stable during drags) */
  key: string;
  orig: EventOccurrence;
  occ: EventOccurrence;
}

interface Segment {
  key: string;
  start: number;
  end: number;
  shown: Shown;
}

function segmentsForDay(list: Shown[], day: number): Segment[] {
  const dayEnd = addDays(day, 1);
  return list
    .filter(({ occ }) => occ.start < dayEnd && (occ.end > day || (occ.end === occ.start && occ.start >= day)))
    .map((s) => ({ key: s.key, start: Math.max(s.occ.start, day), end: Math.min(s.occ.end, dayEnd), shown: s }));
}

/** Minutes since midnight → "HH:MM" */
function hm(m: number): string {
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function applyGridDrag(list: Shown[], drag: GridDrag | null): Shown[] {
  if (!drag || drag.kind === 'create') return list;
  return list.map((s) => (s.key === drag.key ? { ...s, occ: { ...s.occ, start: drag.start, end: drag.end } } : s));
}

export function TimeGrid({ days }: { days: number[] }): JSX.Element {
  const cs = useCalSettings();
  const occurrences = useCalendar((s) => s.occurrences);
  const calendarList = useCalendar((s) => s.calendars);
  const selected = useCalendar((s) => s.selected);
  const setDate = useCalendar((s) => s.setDate);
  const setView = useCalendar((s) => s.setView);
  const now = useNow();
  const today = startOfDay(now);

  const slot = cs.timeScale;
  const slotPx = SLOT_PX[slot] ?? 24;
  const ppm = slotPx / slot;
  const workStart = parseHm(cs.workStart, 8 * 60);
  const workEnd = parseHm(cs.workEnd, 17 * 60);
  const workDays = useMemo(() => new Set(workDaysOf(cs)), [cs]);
  const calendars = useMemo(() => new Map(calendarList.map((c) => [c.id, c])), [calendarList]);

  const bodyRef = useRef<HTMLDivElement>(null);
  const { drag, beginCreate, beginEvent } = useGridDrag({ body: bodyRef, ppm, slot });

  // scroll to the start of the working day when the grid is shown or the scale changes
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = Math.max(0, workStart * ppm - 8);
  }, [ppm, workStart]);

  const allDay = useMemo(() => occurrences.filter(isAllDayLike), [occurrences]);
  const timed = useMemo(
    () => applyGridDrag(occurrences.filter((o) => !isAllDayLike(o)).map((o) => ({ key: occurrenceKey(o), orig: o, occ: o })), drag),
    [occurrences, drag]
  );
  const minMinutes = Math.ceil(20 / ppm);
  const columns = useMemo(
    () => days.map((day) => ({ day, placed: packColumns(segmentsForDay(timed, day), minMinutes * MINUTE_MS) })),
    [days, timed, minMinutes]
  );

  const n = days.length;
  const gridCols = `56px repeat(${n}, minmax(0, 1fr))`;
  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div className={clsx('cal-grid', drag && 'dragging')} style={{ ['--slot-h' as string]: `${slotPx}px`, ['--hour-h' as string]: `${60 * ppm}px` }}>
      <div className="cal-grid-head" style={{ gridTemplateColumns: gridCols }}>
        <div className="cal-grid-kw">{cs.showWeekNumbers ? `KW ${isoWeek(days[0])}` : ''}</div>
        {days.map((d) => (
          <button
            key={d}
            className={clsx('cal-day-head', d === today && 'today', !workDays.has(new Date(d).getDay()) && 'weekend')}
            onClick={() => {
              setDate(d);
              if (n > 1) setView('day');
            }}
            title="Tagesansicht öffnen"
          >
            <span className="cal-day-num">{new Date(d).getDate()}</span>
            <span className="cal-day-name">{n === 1 ? new Date(d).toLocaleDateString('de-DE', { weekday: 'long' }) : WEEKDAY_SHORT[new Date(d).getDay()]}</span>
          </button>
        ))}
      </div>
      <AllDayRow days={days} occs={allDay} calendars={calendars} selected={selected} />
      <div className="cal-grid-body" ref={bodyRef}>
        <div className="cal-grid-inner" style={{ gridTemplateColumns: gridCols, height: 1440 * ppm }}>
          <div className="cal-gutter">
            {hours.slice(1).map((h) => (
              <span key={h} className="cal-hour-label" style={{ top: h * 60 * ppm }}>
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {columns.map(({ day, placed }) => {
            const isWork = workDays.has(new Date(day).getDay());
            return (
              <div key={day} data-day={day} className={clsx('cal-col', day === today && 'today')} onPointerDown={(e) => beginCreate(e, day)}>
                {isWork ? (
                  <>
                    <div className="cal-off" style={{ top: 0, height: workStart * ppm }} />
                    <div className="cal-off" style={{ top: workEnd * ppm, bottom: 0 }} />
                  </>
                ) : (
                  <div className="cal-off" style={{ top: 0, bottom: 0 }} />
                )}
                {drag?.kind === 'create' && drag.day === day && (
                  <div className="cal-ghost" style={{ top: drag.from * ppm, height: (drag.to - drag.from) * ppm }}>
                    {hm(drag.from)}–{hm(drag.to)}
                  </div>
                )}
                {placed.map(({ item, col, cols, span }) => (
                  <GridEvent
                    key={item.key}
                    seg={item}
                    day={day}
                    ppm={ppm}
                    minMinutes={minMinutes}
                    left={col / cols}
                    width={span / cols}
                    calendars={calendars}
                    selected={selected}
                    dragging={!!drag && drag.kind !== 'create' && drag.key === item.key}
                    onPointerDown={(e, mode) => beginEvent(e, item.shown.orig, mode)}
                  />
                ))}
                {day === today && (
                  <div className="cal-now" style={{ top: minutesOfDay(now) * ppm }}>
                    <span className="cal-now-dot" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GridEvent({
  seg,
  day,
  ppm,
  minMinutes,
  left,
  width,
  calendars,
  selected,
  dragging,
  onPointerDown
}: {
  seg: Segment;
  day: number;
  ppm: number;
  minMinutes: number;
  left: number;
  width: number;
  calendars: Map<string, Calendar>;
  selected: Selection | null;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent, mode: 'move' | 'resize') => void;
}): JSX.Element {
  const { occ, orig } = seg.shown;
  const ev = occ.event;
  const top = ((seg.start - day) / MINUTE_MS) * ppm;
  const height = Math.max(minMinutes, (seg.end - seg.start) / MINUTE_MS) * ppm;
  const compact = height < COMPACT_PX;
  const isSel = !!selected && selected.id === ev.id && selected.start === orig.start;
  const continuesAfter = occ.end > seg.end;
  return (
    <EventMenu occ={orig}>
      <div
        className={clsx(eventClasses(ev, isSel), 'cal-block', compact && 'compact', dragging && 'is-dragging', occ.start < seg.start && 'cut-top', continuesAfter && 'cut-bottom')}
        style={{
          ...eventColorStyle(ev, calendars),
          top,
          height: height - 1,
          left: `calc(${left * 100}% + 1px)`,
          width: `calc(${width * 100}% - ${left + width >= 0.999 ? 8 : 3}px)`
        }}
        title={`${ev.title}\n${timeRange(occ)}${ev.location ? '\n' + ev.location : ''}`}
        onPointerDown={(e) => onPointerDown(e, 'move')}
        onDoubleClick={(e) => {
          e.stopPropagation();
          openOccurrence(orig);
        }}
      >
        {compact ? (
          <div className="cal-block-line ellipsis">
            <span className="cal-ev-title">{ev.title}</span>
            <span className="cal-ev-sub"> {timeRange(occ)}</span>
          </div>
        ) : (
          <>
            <div className="cal-ev-title cal-block-title">
              {ev.title}
              <EventIcons ev={ev} />
            </div>
            <div className="cal-ev-sub ellipsis">{timeRange(occ)}</div>
            {ev.location && <div className="cal-ev-sub ellipsis">{ev.location}</div>}
          </>
        )}
        {!continuesAfter && <div className="cal-resize" onPointerDown={(e) => onPointerDown(e, 'resize')} />}
      </div>
    </EventMenu>
  );
}
