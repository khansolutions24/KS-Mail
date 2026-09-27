import { describe, expect, it } from 'vitest';
import { daySpan, packColumns, packLanes, type TimedItem } from '../layout';

const H = 3600000;
const item = (key: string, startH: number, endH: number): TimedItem => ({ key, start: startH * H, end: endH * H });
const byKey = <T extends { item: TimedItem }>(list: T[]): Record<string, Omit<T, 'item'>> =>
  Object.fromEntries(list.map(({ item: it, ...rest }) => [it.key, rest]));

describe('packColumns', () => {
  it('keeps non-overlapping events full width', () => {
    const r = byKey(packColumns([item('a', 9, 10), item('b', 10, 11), item('c', 13, 14)]));
    expect(r.a).toEqual({ col: 0, cols: 1, span: 1 });
    expect(r.b).toEqual({ col: 0, cols: 1, span: 1 });
    expect(r.c).toEqual({ col: 0, cols: 1, span: 1 });
  });

  it('puts overlapping events side by side', () => {
    const r = byKey(packColumns([item('a', 9, 11), item('b', 10, 12)]));
    expect(r.a).toMatchObject({ col: 0, cols: 2 });
    expect(r.b).toMatchObject({ col: 1, cols: 2 });
  });

  it('reuses freed columns and shares the column count within a cluster', () => {
    // a: 9-12, b: 9-10, c: 10-11 (fits into b's column), d: 11-12
    const r = byKey(packColumns([item('a', 9, 12), item('b', 9, 10), item('c', 10, 11), item('d', 11, 12)]));
    expect(r.a).toMatchObject({ col: 0, cols: 2 });
    expect(r.b).toMatchObject({ col: 1, cols: 2 });
    expect(r.c).toMatchObject({ col: 1, cols: 2 });
    expect(r.d).toMatchObject({ col: 1, cols: 2 });
  });

  it('orders by start, longer events first, and widens over free columns', () => {
    const r = byKey(packColumns([item('a', 9, 10), item('b', 9, 12), item('c', 9, 9.5), item('d', 10.5, 11)]));
    // same start → the longest event gets the leftmost column
    expect(r.b).toMatchObject({ col: 0, cols: 3, span: 1 });
    expect(r.a).toMatchObject({ col: 1, cols: 3, span: 1 });
    expect(r.c).toMatchObject({ col: 2, cols: 3, span: 1 });
    // d reuses a's column; c's column is free by then → d spans two columns
    expect(r.d).toMatchObject({ col: 1, cols: 3, span: 2 });
  });

  it('does not widen over a column that is busy during the event', () => {
    const r = byKey(packColumns([item('a', 9, 12), item('b', 9, 10), item('c', 9, 11.5), item('d', 11, 12)]));
    expect(r.a).toMatchObject({ col: 0, cols: 3 });
    expect(r.c).toMatchObject({ col: 1, cols: 3 });
    expect(r.b).toMatchObject({ col: 2, cols: 3, span: 1 });
    expect(r.d).toMatchObject({ col: 2, cols: 3, span: 1 });
  });

  it('starts a new cluster after a gap', () => {
    const r = byKey(packColumns([item('a', 9, 11), item('b', 10, 11), item('c', 11, 12)]));
    expect(r.c).toEqual({ col: 0, cols: 1, span: 1 });
  });

  it('gives zero-length events a minimum duration for overlap', () => {
    const r = byKey(packColumns([item('a', 9, 9), item('b', 9.1, 10)], 0.5 * H));
    expect(r.a).toMatchObject({ col: 0, cols: 2 });
    expect(r.b).toMatchObject({ col: 1, cols: 2 });
    const r2 = byKey(packColumns([item('a', 9, 9), item('b', 9.1, 10)]));
    expect(r2.b).toMatchObject({ col: 0, cols: 1 });
  });
});

describe('packLanes', () => {
  it('stacks overlapping bars and reuses free lanes', () => {
    const lanes = packLanes([
      { key: 'a', from: 0, to: 3 },
      { key: 'b', from: 1, to: 2 },
      { key: 'c', from: 3, to: 5 },
      { key: 'd', from: 2, to: 4 }
    ]);
    expect(lanes.get('a')).toBe(0);
    expect(lanes.get('b')).toBe(1);
    expect(lanes.get('d')).toBe(1);
    expect(lanes.get('c')).toBe(0);
  });

  it('places longer bars first on the same start day', () => {
    const lanes = packLanes([
      { key: 'short', from: 0, to: 1 },
      { key: 'long', from: 0, to: 4 }
    ]);
    expect(lanes.get('long')).toBe(0);
    expect(lanes.get('short')).toBe(1);
  });
});

describe('daySpan', () => {
  const day = (d: number): number => new Date(2026, 8, d).getTime();
  const days = [21, 22, 23, 24, 25].map(day);

  it('maps a timed event to its day', () => {
    expect(daySpan(days, day(22) + 9 * H, day(22) + 10 * H)).toEqual({ from: 1, to: 2 });
  });

  it('treats all-day ends as exclusive', () => {
    expect(daySpan(days, day(22), day(24))).toEqual({ from: 1, to: 3 });
  });

  it('clips to the visible days and ignores events outside', () => {
    expect(daySpan(days, day(19), day(23))).toEqual({ from: 0, to: 2 });
    expect(daySpan(days, day(27), day(28))).toBeNull();
  });

  it('keeps zero-length events on their day', () => {
    expect(daySpan(days, day(23), day(23))).toEqual({ from: 2, to: 3 });
  });
});
