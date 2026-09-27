// Local editable copy of a record with debounced saving (also used by the notes module).
//
// External updates of the source record are adopted only while no local edit is pending or
// being saved, so reloads triggered by our own saves never overwrite text the user is typing.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface DebouncedDraft<T> {
  draft: T | null;
  /** Applies a patch locally; saves after the delay, or right away when `immediate` */
  update(patch: Partial<T>, immediate?: boolean): void;
  /** Saves a pending change now */
  flush(): void;
}

export function useDebouncedDraft<T extends { id: string }>(source: T | null, save: (t: T) => Promise<T | undefined>, delay = 600): DebouncedDraft<T> {
  const [draft, setDraft] = useState<T | null>(source);
  const latest = useRef<T | null>(source);
  const timer = useRef<number | null>(null);
  const inFlight = useRef(0);
  const saveRef = useRef(save);
  saveRef.current = save;

  const run = useCallback(async (t: T): Promise<void> => {
    inFlight.current++;
    try {
      const saved = await saveRef.current(t);
      // adopt server-side changes (e.g. completedAt) unless the user kept editing
      if (saved && inFlight.current === 1 && timer.current === null && latest.current?.id === saved.id) {
        latest.current = saved;
        setDraft(saved);
      }
    } finally {
      inFlight.current--;
    }
  }, []);

  const flush = useCallback((): void => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
    if (latest.current) void run(latest.current);
  }, [run]);

  // follow the source record
  useEffect(() => {
    const cur = latest.current;
    if (!source) {
      flush();
      latest.current = null;
      setDraft(null);
    } else if (!cur || cur.id !== source.id) {
      flush();
      latest.current = source;
      setDraft(source);
    } else if (timer.current === null && inFlight.current === 0 && cur !== source) {
      latest.current = source;
      setDraft(source);
    }
  }, [source, flush]);

  // save pending edits when unmounting
  useEffect(() => flush, [flush]);

  const update = useCallback(
    (patch: Partial<T>, immediate = false): void => {
      if (!latest.current) return;
      const next = { ...latest.current, ...patch };
      latest.current = next;
      setDraft(next);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      if (immediate) void run(next);
      else
        timer.current = window.setTimeout(() => {
          timer.current = null;
          void run(next);
        }, delay);
    },
    [run, delay]
  );

  return { draft, update, flush };
}
