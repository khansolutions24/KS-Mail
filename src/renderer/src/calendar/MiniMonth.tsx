// Small month navigator in the side pane: click a day to jump there.

import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { IconButton } from '../components/ui';
import { addDays, isoWeek, startOfDay, startOfMonth, startOfWeek } from '../lib/format';
import { visibleDays, WEEKDAY_SHORT } from './dates';
import { useCalSettings, useCalendar } from './store';
import { useNow } from './useNow';

export function MiniMonth(): JSX.Element {
  const cs = useCalSettings();
  const view = useCalendar((s) => s.view);
  const date = useCalendar((s) => s.date);
  const setDate = useCalendar((s) => s.setDate);
  const today = startOfDay(useNow());
  const [month, setMonth] = useState(() => startOfMonth(date));

  // follow the main view when it moves to another month
  useEffect(() => setMonth(startOfMonth(date)), [date]);

  const selected = useMemo(() => {
    const days = visibleDays(view, date, cs);
    const shownMonth = new Date(date).getMonth();
    return new Set(view === 'month' ? days.filter((d) => new Date(d).getMonth() === shownMonth) : days);
  }, [view, date, cs]);

  const first = startOfWeek(month, cs.weekStart);
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, i) => addDays(first, w * 7 + i)));
  const weekdays = Array.from({ length: 7 }, (_, i) => WEEKDAY_SHORT[(cs.weekStart + i) % 7]);
  const shift = (dir: number): void => {
    const d = new Date(month);
    d.setMonth(d.getMonth() + dir);
    setMonth(d.getTime());
  };
  const curMonth = new Date(month).getMonth();

  return (
    <div className="cal-mini">
      <div className="cal-mini-head">
        <button className="cal-mini-title" onClick={() => setDate(month)} title="Zu diesem Monat wechseln">
          {new Date(month).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
        </button>
        <IconButton small label="Vorheriger Monat" onClick={() => shift(-1)}>
          <ChevronLeft size={16} />
        </IconButton>
        <IconButton small label="Nächster Monat" onClick={() => shift(1)}>
          <ChevronRight size={16} />
        </IconButton>
      </div>
      <div className={clsx('cal-mini-grid', cs.showWeekNumbers && 'with-weeks')} role="grid">
        {cs.showWeekNumbers && <span className="cal-mini-wd" />}
        {weekdays.map((d) => (
          <span key={d} className="cal-mini-wd">
            {d}
          </span>
        ))}
        {weeks.map((week) => [
          cs.showWeekNumbers ? (
            <span key={`w${week[0]}`} className="cal-mini-kw" title={`Kalenderwoche ${isoWeek(week[0])}`}>
              {isoWeek(week[0])}
            </span>
          ) : null,
          ...week.map((d) => (
            <button
              key={d}
              role="gridcell"
              className={clsx('cal-mini-day', new Date(d).getMonth() !== curMonth && 'other', d === today && 'today', selected.has(d) && 'selected')}
              onClick={() => setDate(d)}
              title={new Date(d).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            >
              {new Date(d).getDate()}
            </button>
          ))
        ])}
      </div>
    </div>
  );
}
