// Expansion of simple recurrence rules (subset of RFC 5545 RRULE) in local time.

import type { CalendarEvent, EventOccurrence, Recurrence } from './types';

const MAX_ITER = 200000;

function withDate(base: Date, y: number, m: number, d: number): Date | null {
  const out = new Date(base);
  out.setFullYear(y, m, d);
  // month overflow (e.g. 31st in a 30-day month) → skip this occurrence
  if (out.getMonth() !== ((m % 12) + 12) % 12) return null;
  return out;
}

/** Yields occurrence start times in ascending order, beginning at dtstart */
export function* occurrenceStarts(dtstart: number, rule: Recurrence | null): Generator<number> {
  if (!rule) {
    yield dtstart;
    return;
  }
  const start = new Date(dtstart);
  const interval = Math.max(1, rule.interval || 1);
  let emitted = 0;
  const done = (t: number): boolean => (rule.until != null && t > rule.until) || (rule.count != null && emitted >= rule.count);

  if (rule.freq === 'WEEKLY' && rule.byDay && rule.byDay.length) {
    // weeks start on Monday (RFC 5545 default WKST=MO)
    const days = [...new Set(rule.byDay)].map((d) => (d + 6) % 7).sort((a, b) => a - b); // 0 = Monday
    const weekStart = new Date(start);
    weekStart.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    for (let w = 0; w < MAX_ITER; w += interval) {
      for (const off of days) {
        const c = new Date(weekStart);
        c.setDate(weekStart.getDate() + w * 7 + off);
        const t = c.getTime();
        if (t < dtstart) continue;
        if (done(t)) return;
        emitted++;
        yield t;
      }
    }
    return;
  }

  for (let i = 0; i < MAX_ITER; i++) {
    let c: Date | null;
    const n = i * interval;
    switch (rule.freq) {
      case 'DAILY':
        c = new Date(start);
        c.setDate(start.getDate() + n);
        break;
      case 'WEEKLY':
        c = new Date(start);
        c.setDate(start.getDate() + n * 7);
        break;
      case 'MONTHLY':
        c = withDate(start, start.getFullYear(), start.getMonth() + n, start.getDate());
        break;
      case 'YEARLY':
        c = withDate(start, start.getFullYear() + n, start.getMonth(), start.getDate());
        break;
    }
    if (!c) continue;
    const t = c.getTime();
    if (done(t)) return;
    emitted++;
    yield t;
  }
}

/** All occurrences of `ev` that overlap [from, to) */
export function expandEvent(ev: CalendarEvent, from: number, to: number): EventOccurrence[] {
  const dur = Math.max(0, ev.end - ev.start);
  const ex = new Set(ev.exdates);
  const out: EventOccurrence[] = [];
  for (const s of occurrenceStarts(ev.start, ev.recurrence)) {
    if (s >= to) break;
    if (s + dur <= from && !(dur === 0 && s === from)) continue;
    if (ex.has(s)) continue;
    out.push({ event: ev, start: s, end: s + dur });
  }
  return out;
}

export function expandEvents(events: CalendarEvent[], from: number, to: number): EventOccurrence[] {
  return events.flatMap((e) => expandEvent(e, from, to)).sort((a, b) => a.start - b.start || b.end - a.end);
}

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export function describeRecurrence(r: Recurrence | null): string {
  if (!r) return 'Keine Wiederholung';
  const n = r.interval > 1 ? r.interval : 0;
  let s: string;
  switch (r.freq) {
    case 'DAILY':
      s = n ? `Alle ${n} Tage` : 'Täglich';
      break;
    case 'WEEKLY':
      s = n ? `Alle ${n} Wochen` : 'Wöchentlich';
      if (r.byDay?.length) s += ` am ${[...r.byDay].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WD[d]).join(', ')}`;
      break;
    case 'MONTHLY':
      s = n ? `Alle ${n} Monate` : 'Monatlich';
      break;
    case 'YEARLY':
      s = n ? `Alle ${n} Jahre` : 'Jährlich';
      break;
  }
  if (r.count) s += `, ${r.count}-mal`;
  if (r.until) s += `, bis ${new Date(r.until).toLocaleDateString('de-DE')}`;
  return s;
}
