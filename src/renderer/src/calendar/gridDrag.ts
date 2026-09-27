// Pointer interactions of the time grid: drag-to-create, move (also across days) and resize.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { EventOccurrence } from '@shared/types';
import { atMinutes, MINUTE_MS, roundToMinutes } from './dates';
import { moveOccurrence, openNewEvent } from './actions';
import { isReadOnly, occurrenceKey, useCalendar } from './store';

export type GridDrag =
  | { kind: 'create'; day: number; from: number; to: number }
  | { kind: 'move' | 'resize'; key: string; start: number; end: number };

/** Moves and resizes snap to this many minutes */
export const DRAG_STEP = 15;
const THRESHOLD = 4;
const EDGE = 32;

interface Options {
  body: RefObject<HTMLDivElement>;
  /** Pixels per minute */
  ppm: number;
  /** Slot length in minutes (drag-to-create granularity) */
  slot: number;
}

export function useGridDrag({ body, ppm, slot }: Options): {
  drag: GridDrag | null;
  beginCreate: (e: React.PointerEvent<HTMLElement>, day: number) => void;
  beginEvent: (e: React.PointerEvent, o: EventOccurrence, mode: 'move' | 'resize') => void;
} {
  const [drag, setDrag] = useState<GridDrag | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const minuteIn = useCallback((col: HTMLElement, y: number): number => {
    const r = col.getBoundingClientRect();
    return Math.min(1440, Math.max(0, Math.round((y - r.top) / ppm)));
  }, [ppm]);

  /** Time under the pointer: day column by x (clamped to the first/last column), minute by y */
  const timeAt = useCallback(
    (x: number, y: number): number | null => {
      const cols = [...(body.current?.querySelectorAll<HTMLElement>('.cal-col[data-day]') ?? [])];
      if (!cols.length) return null;
      const col = cols.find((c) => {
        const r = c.getBoundingClientRect();
        return x >= r.left && x < r.right;
      }) ?? (x < cols[0].getBoundingClientRect().left ? cols[0] : cols[cols.length - 1]);
      return atMinutes(Number(col.dataset.day), minuteIn(col, y));
    },
    [body, minuteIn]
  );

  /** Registers window listeners for one drag gesture */
  const track = useCallback(
    (x0: number, y0: number, onMove: (e: PointerEvent) => void, onEnd: (moved: boolean, commit: boolean) => void): void => {
      let moved = false;
      const move = (e: PointerEvent): void => {
        if (!moved && Math.hypot(e.clientX - x0, e.clientY - y0) < THRESHOLD) return;
        moved = true;
        // auto-scroll near the top / bottom edge of the scroll area
        const el = body.current;
        if (el) {
          const r = el.getBoundingClientRect();
          if (e.clientY < r.top + EDGE) el.scrollTop -= 12;
          else if (e.clientY > r.bottom - EDGE) el.scrollTop += 12;
        }
        onMove(e);
      };
      const finish = (commit: boolean): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('keydown', key);
        cleanup.current = null;
        onEnd(moved, commit);
      };
      const up = (): void => finish(true);
      const key = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') finish(false);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('keydown', key);
      cleanup.current = () => finish(false);
    },
    [body]
  );

  const beginCreate = useCallback(
    (e: React.PointerEvent<HTMLElement>, day: number) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('.cal-ev')) return;
      const col = e.currentTarget;
      useCalendar.getState().select(null);
      const anchor = Math.min(1440 - slot, Math.floor(minuteIn(col, e.clientY) / slot) * slot);
      let range = { from: anchor, to: anchor + slot };
      setDrag({ kind: 'create', day, ...range });
      track(
        e.clientX,
        e.clientY,
        (ev) => {
          const m = minuteIn(col, ev.clientY);
          range = m < anchor ? { from: Math.floor(m / slot) * slot, to: anchor + slot } : { from: anchor, to: Math.max(anchor + slot, Math.ceil(m / slot) * slot) };
          setDrag({ kind: 'create', day, ...range });
        },
        (moved, commit) => {
          setDrag(null);
          if (!commit) return;
          if (moved) openNewEvent(atMinutes(day, range.from), atMinutes(day, range.to));
          else openNewEvent(atMinutes(day, anchor));
        }
      );
    },
    [minuteIn, slot, track]
  );

  const beginEvent = useCallback(
    (e: React.PointerEvent, o: EventOccurrence, mode: 'move' | 'resize') => {
      if (e.button !== 0) return;
      e.stopPropagation();
      useCalendar.getState().select({ id: o.event.id, start: o.start });
      if (isReadOnly(o.event)) return;
      const t0 = timeAt(e.clientX, e.clientY);
      if (t0 === null) return;
      const key = occurrenceKey(o);
      const grab = t0 - o.start;
      const duration = o.end - o.start;
      let next = { start: o.start, end: o.end };
      track(
        e.clientX,
        e.clientY,
        (ev) => {
          const t = timeAt(ev.clientX, ev.clientY);
          if (t === null) return;
          if (mode === 'move') {
            const start = roundToMinutes(t - grab, DRAG_STEP);
            next = { start, end: start + duration };
          } else {
            next = { start: o.start, end: Math.max(o.start + DRAG_STEP * MINUTE_MS, roundToMinutes(t, DRAG_STEP)) };
          }
          setDrag({ kind: mode, key, ...next });
        },
        (moved, commit) => {
          if (moved && commit && (next.start !== o.start || next.end !== o.end)) {
            // keep the preview until saved (the series question may be pending)
            void moveOccurrence(o, next.start, next.end).finally(() => setDrag(null));
          } else {
            setDrag(null);
          }
        }
      );
    },
    [timeAt, track]
  );

  return { drag, beginCreate, beginEvent };
}
