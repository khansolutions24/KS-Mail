// Pure layout algorithms for the calendar views (no React / DOM), unit tested in __tests__/layout.test.ts.

export interface TimedItem {
  key: string;
  start: number;
  end: number;
}

export interface PlacedItem<T extends TimedItem> {
  item: T;
  /** Column index inside its overlap cluster (0-based) */
  col: number;
  /** Number of columns in the cluster: the item's base width is 1 / cols */
  cols: number;
  /** Number of columns the item may occupy (≥ 1) because the columns to its right are free */
  span: number;
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean => aStart < bEnd && bStart < aEnd;

/**
 * Side-by-side layout of overlapping events in a day column (Outlook / Google style).
 *
 * Events are grouped into clusters of transitively overlapping items. Inside a cluster every event
 * gets the first column that is free at its start time; all events of a cluster share the same
 * column count so the widths line up. Afterwards each event is widened to the right over columns
 * that stay free during its whole duration.
 *
 * `minDuration` gives very short / zero-length events a visual height that also counts for overlap.
 */
export function packColumns<T extends TimedItem>(items: T[], minDuration = 0): PlacedItem<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end || a.key.localeCompare(b.key));
  const visEnd = (t: T): number => Math.max(t.end, t.start + minDuration);
  const out: PlacedItem<T>[] = [];

  let cluster: { item: T; col: number }[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = (): void => {
    const cols = columnEnds.length;
    for (const c of cluster) {
      let span = 1;
      // widen while the next column is free for the whole duration of this event
      for (let next = c.col + 1; next < cols; next++) {
        const blocked = cluster.some((o) => o.col === next && overlaps(c.item.start, visEnd(c.item), o.item.start, visEnd(o.item)));
        if (blocked) break;
        span++;
      }
      out.push({ item: c.item, col: c.col, cols, span });
    }
    cluster = [];
    columnEnds = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    if (cluster.length && item.start >= clusterEnd) flush();
    let col = columnEnds.findIndex((end) => end <= item.start);
    if (col < 0) {
      col = columnEnds.length;
      columnEnds.push(visEnd(item));
    } else {
      columnEnds[col] = visEnd(item);
    }
    cluster.push({ item, col });
    clusterEnd = Math.max(clusterEnd, visEnd(item));
  }
  if (cluster.length) flush();
  return out;
}

export interface SpanItem {
  key: string;
  /** First day index (inclusive) */
  from: number;
  /** Last day index (exclusive) */
  to: number;
}

/**
 * Assigns horizontal bars (multi-day / all-day events, month cells) to stacked lanes so that bars
 * in the same lane never share a day. Longer bars are placed first to keep them on top; otherwise
 * the input order is kept (the sort is stable), so callers pass items sorted by start time.
 * Returns the lane per item key.
 */
export function packLanes(items: SpanItem[]): Map<string, number> {
  const sorted = [...items].sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from));
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const it of sorted) {
    let lane = laneEnds.findIndex((end) => end <= it.from);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(it.to);
    } else {
      laneEnds[lane] = it.to;
    }
    lanes.set(it.key, lane);
  }
  return lanes;
}

/**
 * Day index range [from, to) of an interval relative to a list of day starts (ascending, not
 * necessarily consecutive, e.g. a work week).
 * An event ending exactly at midnight does not occupy the following day; zero-length events occupy
 * their start day. Returns null when the interval does not touch any of the days.
 */
export function daySpan(days: number[], start: number, end: number): { from: number; to: number } | null {
  if (!days.length) return null;
  const lastInstant = Math.max(start, end - 1);
  let from = -1;
  let to = -1;
  for (let i = 0; i < days.length; i++) {
    const dayStart = days[i];
    const dayEnd = nextDay(dayStart);
    if (start < dayEnd && lastInstant >= dayStart) {
      if (from < 0) from = i;
      to = i + 1;
    }
  }
  return from < 0 ? null : { from, to };
}

function nextDay(t: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}
