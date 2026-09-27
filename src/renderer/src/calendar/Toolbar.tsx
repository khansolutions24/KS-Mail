// Ribbon: today / previous / next, range title, view switcher, new event.

import clsx from 'clsx';
import { CalendarCheck, CalendarDays, CalendarPlus, CalendarRange, ChevronLeft, ChevronRight, List, Rows3, Square, type LucideIcon } from 'lucide-react';
import { shortcutFor } from '../lib/commands';
import { formatKeys } from '../lib/keys';
import { Button, IconButton } from '../components/ui';
import { openNewEvent } from './actions';
import { rangeTitle, VIEW_LABELS, type CalView } from './dates';
import { useCalSettings, useCalendar } from './store';

const VIEWS: { view: CalView; icon: LucideIcon; cmd: string }[] = [
  { view: 'day', icon: Square, cmd: 'calendar.viewDay' },
  { view: 'workweek', icon: CalendarRange, cmd: 'calendar.viewWorkweek' },
  { view: 'week', icon: Rows3, cmd: 'calendar.viewWeek' },
  { view: 'month', icon: CalendarDays, cmd: 'calendar.viewMonth' },
  { view: 'agenda', icon: List, cmd: 'calendar.viewAgenda' }
];

function hint(label: string, cmd: string): string {
  const keys = shortcutFor(cmd);
  return keys ? `${label} (${formatKeys(keys)})` : label;
}

export function Toolbar(): JSX.Element {
  const cs = useCalSettings();
  const view = useCalendar((s) => s.view);
  const date = useCalendar((s) => s.date);
  const { setView, goToday, step } = useCalendar.getState();
  return (
    <div className="ribbon cal-ribbon">
      <Button variant="primary" icon={<CalendarPlus size={16} />} onClick={() => openNewEvent()} title={hint('Neuer Termin', 'calendar.newEvent')}>
        Neuer Termin
      </Button>
      <div className="ribbon-sep" />
      <Button variant="subtle" icon={<CalendarCheck size={16} />} onClick={goToday} title={hint('Heute', 'calendar.today')}>
        Heute
      </Button>
      <IconButton label={hint('Zurück', 'calendar.prev')} onClick={() => step(-1)}>
        <ChevronLeft size={18} />
      </IconButton>
      <IconButton label={hint('Weiter', 'calendar.next')} onClick={() => step(1)}>
        <ChevronRight size={18} />
      </IconButton>
      <h2 className="cal-range-title">{rangeTitle(view, date, cs)}</h2>
      <div className="cal-views" role="tablist" aria-label="Ansicht">
        {VIEWS.map(({ view: v, icon: Icon, cmd }) => (
          <button key={v} role="tab" aria-selected={view === v} className={clsx('cal-view-btn', view === v && 'active')} onClick={() => setView(v)} title={hint(VIEW_LABELS[v], cmd)}>
            <Icon size={16} />
            <span>{VIEW_LABELS[v]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
