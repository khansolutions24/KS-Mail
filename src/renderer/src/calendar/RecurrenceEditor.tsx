// Recurrence part of the event editor: pattern, interval, weekdays and end of the series.

import clsx from 'clsx';
import type { Recurrence } from '@shared/types';
import { describeRecurrence } from '@shared/recurrence';
import { fromInputs, toInputDate } from '../lib/format';
import { DAY_MS, WEEKDAY_SHORT } from './dates';

type Kind = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';
type EndMode = 'never' | 'count' | 'until';

const KIND_LABELS: Record<Kind, string> = {
  none: 'Keine',
  daily: 'Täglich',
  weekdays: 'Wochentags (Mo–Fr)',
  weekly: 'Wöchentlich',
  monthly: 'Monatlich',
  yearly: 'Jährlich'
};

const UNIT: Record<Recurrence['freq'], [string, string]> = {
  DAILY: ['Tag', 'Tage'],
  WEEKLY: ['Woche', 'Wochen'],
  MONTHLY: ['Monat', 'Monate'],
  YEARLY: ['Jahr', 'Jahre']
};

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

function isWeekdays(r: Recurrence): boolean {
  return r.freq === 'WEEKLY' && (r.interval || 1) === 1 && [...(r.byDay ?? [])].sort().join() === '1,2,3,4,5';
}

function kindOf(r: Recurrence | null): Kind {
  if (!r) return 'none';
  if (isWeekdays(r)) return 'weekdays';
  return ({ DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' } as const)[r.freq];
}

function endModeOf(r: Recurrence): EndMode {
  return r.count ? 'count' : r.until != null ? 'until' : 'never';
}

export function RecurrenceEditor({ value, start, weekStart, onChange }: { value: Recurrence | null; start: number; weekStart: number; onChange: (r: Recurrence | null) => void }): JSX.Element {
  const kind = kindOf(value);
  const startDay = new Date(start).getDay();

  const setKind = (k: Kind): void => {
    const keep = value ? { count: value.count, until: value.until } : {};
    const interval = value && kind !== 'weekdays' ? value.interval || 1 : 1;
    switch (k) {
      case 'none':
        return onChange(null);
      case 'daily':
        return onChange({ freq: 'DAILY', interval, ...keep });
      case 'weekdays':
        return onChange({ freq: 'WEEKLY', interval: 1, byDay: [1, 2, 3, 4, 5], ...keep });
      case 'weekly':
        return onChange({ freq: 'WEEKLY', interval, byDay: [startDay], ...keep });
      case 'monthly':
        return onChange({ freq: 'MONTHLY', interval, ...keep });
      case 'yearly':
        return onChange({ freq: 'YEARLY', interval, ...keep });
    }
  };

  const toggleDay = (d: number): void => {
    if (!value) return;
    const cur = new Set(value.byDay?.length ? value.byDay : [startDay]);
    if (cur.has(d)) cur.delete(d);
    else cur.add(d);
    // at least one weekday must stay selected
    onChange({ ...value, byDay: cur.size ? [...cur].sort() : [startDay] });
  };

  const setEnd = (mode: EndMode): void => {
    if (!value) return;
    const rest: Recurrence = { ...value };
    delete rest.count;
    delete rest.until;
    if (mode === 'never') onChange(rest);
    else if (mode === 'count') onChange({ ...rest, count: value.count || 10 });
    else onChange({ ...rest, until: value.until ?? start + 90 * DAY_MS });
  };

  const orderedDays = [...WEEKDAYS].sort((a, b) => ((a - weekStart + 7) % 7) - ((b - weekStart + 7) % 7));

  return (
    <div className="col cal-rec">
      <div className="row cal-rec-row">
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="Wiederholung">
          {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        {value && kind !== 'weekdays' && (
          <label className="row cal-rec-interval">
            <span>alle</span>
            <input
              className="input"
              type="number"
              min={1}
              max={99}
              value={value.interval || 1}
              onChange={(e) => onChange({ ...value, interval: Math.min(99, Math.max(1, Number(e.target.value) || 1)) })}
            />
            <span>{UNIT[value.freq][(value.interval || 1) === 1 ? 0 : 1]}</span>
          </label>
        )}
      </div>
      {value && kind === 'weekly' && (
        <div className="cal-rec-days" role="group" aria-label="Wochentage">
          {orderedDays.map((d) => {
            const on = (value.byDay?.length ? value.byDay : [startDay]).includes(d);
            return (
              <button key={d} type="button" className={clsx('cal-rec-day', on && 'on')} aria-pressed={on} onClick={() => toggleDay(d)}>
                {WEEKDAY_SHORT[d]}
              </button>
            );
          })}
        </div>
      )}
      {value && (
        <div className="row cal-rec-row">
          <span className="muted">Ende:</span>
          <select className="select" value={endModeOf(value)} onChange={(e) => setEnd(e.target.value as EndMode)} aria-label="Ende der Serie">
            <option value="never">Nie</option>
            <option value="count">Nach Anzahl</option>
            <option value="until">Am Datum</option>
          </select>
          {endModeOf(value) === 'count' && (
            <label className="row cal-rec-interval">
              <span>nach</span>
              <input
                className="input"
                type="number"
                min={1}
                max={999}
                value={value.count ?? 1}
                onChange={(e) => onChange({ ...value, count: Math.min(999, Math.max(1, Number(e.target.value) || 1)) })}
              />
              <span>Vorkommen</span>
            </label>
          )}
          {endModeOf(value) === 'until' && (
            <input
              className="input"
              type="date"
              value={toInputDate(value.until ?? start)}
              min={toInputDate(start)}
              onChange={(e) => e.target.value && onChange({ ...value, until: fromInputs(e.target.value, '23:59') + 59999 })}
              aria-label="Enddatum der Serie"
            />
          )}
        </div>
      )}
      {value && <span className="field-hint">{describeRecurrence(value)}</span>}
    </div>
  );
}
