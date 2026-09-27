// Dragging events between whole days (month view, all-day row). Cells carry `data-day={dayStart}`.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventOccurrence } from '@shared/types';
import { addDays } from '../lib/format';
import { dayDiff } from './dates';
import { moveOccurrence } from './actions';
import { isReadOnly, occurrenceKey, useCalendar } from './store';

export interface DayDrag {
  key: string;
  /** Day shift relative to the original position */
  delta: number;
  /** Day start under the pointer */
  target: number;
}

const THRESHOLD = 4;

function dayAt(x: number, y: number): number | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-day]');
  const v = el ? Number(el.dataset.day) : NaN;
  return Number.isFinite(v) ? v : null;
}

/** Applies a running drag to the occurrence list (live preview) */
export function applyDayDrag(occs: EventOccurrence[], drag: DayDrag | null): EventOccurrence[] {
  if (!drag || !drag.delta) return occs;
  return occs.map((o) => (occurrenceKey(o) === drag.key ? { ...o, start: addDays(o.start, drag.delta), end: addDays(o.end, drag.delta) } : o));
}

export function useDayDrag(): { drag: DayDrag | null; begin: (e: React.PointerEvent, o: EventOccurrence) => void } {
  const [drag, setDrag] = useState<DayDrag | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const begin = useCallback((e: React.PointerEvent, o: EventOccurrence) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    useCalendar.getState().select({ id: o.event.id, start: o.start });
    if (isReadOnly(o.event)) return;
    const origin = dayAt(e.clientX, e.clientY);
    if (origin === null) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const key = occurrenceKey(o);
    let current: DayDrag | null = null;

    const move = (ev: PointerEvent): void => {
      if (!current && Math.hypot(ev.clientX - x0, ev.clientY - y0) < THRESHOLD) return;
      const target = dayAt(ev.clientX, ev.clientY) ?? current?.target ?? origin;
      current = { key, target, delta: dayDiff(origin, target) };
      setDrag(current);
    };
    const finish = (commit: boolean): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key_);
      cleanup.current = null;
      const done = current;
      if (commit && done && done.delta) {
        // keep the preview until the backend (and a possible series question) is done
        void moveOccurrence(o, addDays(o.start, done.delta), addDays(o.end, done.delta)).finally(() => setDrag(null));
      } else {
        setDrag(null);
      }
    };
    const up = (): void => finish(true);
    const key_ = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') finish(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key_);
    cleanup.current = () => finish(false);
  }, []);

  return { drag, begin };
}
