// All-day / multi-day events above the time grid, drawn as bars spanning their days.

import clsx from 'clsx';
import { useMemo } from 'react';
import type { Calendar, EventOccurrence } from '@shared/types';
import { openNewEvent, openOccurrence } from './actions';
import { applyDayDrag, useDayDrag } from './dayDrag';
import { EventIcons, EventMenu, eventClasses, eventColorStyle } from './EventParts';
import { DAY_MS } from './dates';
import { daySpan, packLanes } from './layout';
import { occurrenceKey, type Selection } from './store';

const LANE_PX = 24;

export function AllDayRow({ days, occs, calendars, selected }: { days: number[]; occs: EventOccurrence[]; calendars: Map<string, Calendar>; selected: Selection | null }): JSX.Element {
  const { drag, begin } = useDayDrag();
  const shown = useMemo(() => applyDayDrag(occs, drag), [occs, drag]);

  const bars = useMemo(() => {
    const items = shown.flatMap((o, i) => {
      const span = daySpan(days, o.start, o.end);
      // keys must stay stable during a drag, so they are based on the unmodified occurrence
      return span ? [{ key: occurrenceKey(occs[i]), orig: occs[i], occ: o, ...span }] : [];
    });
    const lanes = packLanes(items);
    return items.map((b) => ({ ...b, lane: lanes.get(b.key) ?? 0 }));
  }, [shown, occs, days]);
  const laneCount = bars.reduce((m, b) => Math.max(m, b.lane + 1), 0);
  const n = days.length;

  return (
    <div className="cal-allday" style={{ ['--lanes' as string]: Math.max(1, laneCount) }}>
      <div className="cal-allday-label">Ganztägig</div>
      <div className={clsx('cal-allday-area', drag && 'dragging')} style={{ height: Math.max(1, laneCount) * LANE_PX + 6 }}>
        <div className="cal-allday-cells" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {days.map((d) => (
            <div key={d} data-day={d} className={clsx('cal-allday-cell', drag?.target === d && 'drop-target')} onDoubleClick={() => openNewEvent(d, undefined, true)} />
          ))}
        </div>
        {bars.map((b) => {
          const o = b.occ;
          const isSel = !!selected && selected.id === o.event.id && selected.start === b.orig.start;
          return (
            <EventMenu key={b.key} occ={b.orig}>
              <div
                className={clsx(eventClasses(o.event, isSel), 'cal-bar', drag?.key === b.key && 'is-dragging', o.start < days[b.from] && 'cut-left')}
                style={{
                  ...eventColorStyle(o.event, calendars),
                  top: 3 + b.lane * LANE_PX,
                  left: `calc(${(b.from / n) * 100}% + 2px)`,
                  width: `calc(${((b.to - b.from) / n) * 100}% - 4px)`
                }}
                title={o.event.title}
                onPointerDown={(e) => begin(e, b.orig)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  openOccurrence(b.orig);
                }}
              >
                <span className="cal-ev-title ellipsis">{o.event.title}</span>
                {o.event.location && <span className="cal-ev-sub ellipsis">{o.event.location}</span>}
                <EventIcons ev={o.event} />
              </div>
            </EventMenu>
          );
        })}
      </div>
    </div>
  );
}

/** Whether an occurrence belongs to the all-day row instead of the time grid */
export function isAllDayLike(o: EventOccurrence): boolean {
  return o.event.allDay || o.end - o.start >= DAY_MS;
}
