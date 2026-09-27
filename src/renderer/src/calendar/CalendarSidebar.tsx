// Left side pane: "Neuer Termin", mini month and the list of calendars.

import clsx from 'clsx';
import { CalendarPlus, Cloud, Download, FilePlus2, Globe, MoreHorizontal, Palette, Pencil, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import type { Calendar } from '@shared/types';
import { Button, ContextMenu, IconButton, Menu, type MenuEntry } from '../components/ui';
import { openNewEvent } from './actions';
import {
  CALENDAR_COLORS,
  COLOR_NAMES,
  createCalendar,
  deleteCalendar,
  exportCalendar,
  importInto,
  recolorCalendar,
  refreshCalendar,
  renameCalendar,
  subscribeCalendar,
  toggleVisible
} from './calendarOps';
import { MiniMonth } from './MiniMonth';
import { useCalendar } from './store';

function calendarMenu(cal: Calendar, count: number): MenuEntry[] {
  const entries: MenuEntry[] = [
    { label: 'Umbenennen', icon: <Pencil size={16} />, onSelect: () => void renameCalendar(cal) },
    {
      label: 'Farbe ändern',
      icon: <Palette size={16} />,
      children: CALENDAR_COLORS.map((c) => ({ label: COLOR_NAMES[c], swatch: c, checked: c.toLowerCase() === cal.color.toLowerCase(), onSelect: () => void recolorCalendar(cal, c) }))
    },
    { separator: true },
    { label: 'Exportieren (.ics)', icon: <Download size={16} />, onSelect: () => void exportCalendar(cal.id) },
    { label: 'Importieren (.ics)', icon: <Upload size={16} />, onSelect: () => void importInto(cal.id), disabled: !!cal.subscriptionUrl || !!cal.remote }
  ];
  if (cal.subscriptionUrl) entries.push({ label: 'Abonnement aktualisieren', icon: <RefreshCw size={16} />, onSelect: () => void refreshCalendar(cal) });
  if (cal.remote) entries.push({ label: 'Mit Microsoft 365 synchronisieren', icon: <RefreshCw size={16} />, onSelect: () => void refreshCalendar(cal) });
  entries.push({ separator: true }, { label: 'Löschen', icon: <Trash2 size={16} />, danger: true, disabled: count <= 1 || !!cal.remote, onSelect: () => void deleteCalendar(cal) });
  return entries;
}

function CalendarItem({ cal, count }: { cal: Calendar; count: number }): JSX.Element {
  const active = useCalendar((s) => s.activeCalendarId === cal.id);
  const setActive = useCalendar((s) => s.setActiveCalendar);
  const items = (): MenuEntry[] => calendarMenu(cal, count);
  return (
    <ContextMenu items={items}>
      <div className={clsx('nav-item cal-entry', active && 'active')} onClick={() => setActive(cal.id)} title={cal.subscriptionUrl ? `Abonniert: ${cal.subscriptionUrl}` : cal.remote ? `${cal.name} – synchronisiert mit Microsoft 365` : cal.name}>
        <input
          type="checkbox"
          className="cal-check"
          style={{ ['--cal' as string]: cal.color }}
          checked={cal.visible}
          aria-label={`${cal.name} anzeigen`}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => void toggleVisible(cal, e.target.checked)}
        />
        <span className="grow ellipsis">{cal.name}</span>
        {cal.subscriptionUrl && <Globe size={14} className="cal-entry-sub" />}
        {cal.remote && <Cloud size={14} className="cal-entry-sub" />}
        <span className="cal-entry-more" onClick={(e) => e.stopPropagation()}>
          <Menu
            align="end"
            items={items()}
            trigger={
              <IconButton small label="Weitere Optionen">
                <MoreHorizontal size={16} />
              </IconButton>
            }
          />
        </span>
      </div>
    </ContextMenu>
  );
}

export function CalendarSidebar(): JSX.Element {
  const calendars = useCalendar((s) => s.calendars);
  const addItems: MenuEntry[] = [
    { label: 'Neuer Kalender', icon: <FilePlus2 size={16} />, onSelect: () => void createCalendar() },
    { label: 'Internetkalender abonnieren', icon: <Globe size={16} />, onSelect: () => void subscribeCalendar() },
    {
      label: 'Aus Datei importieren',
      icon: <Upload size={16} />,
      children: [{ header: 'In Kalender importieren' }, ...calendars.filter((c) => !c.subscriptionUrl).map((c) => ({ label: c.name, swatch: c.color, onSelect: () => void importInto(c.id) }))]
    }
  ];
  return (
    <aside className="pane pane-side cal-side">
      <div className="cal-side-top">
        <Button variant="primary" className="cal-new-btn" icon={<CalendarPlus size={16} />} onClick={() => openNewEvent()}>
          Neuer Termin
        </Button>
      </div>
      <MiniMonth />
      <div className="nav-section">
        <span className="grow">Meine Kalender</span>
      </div>
      <div className="nav-list cal-list">
        {calendars.map((c) => (
          <CalendarItem key={c.id} cal={c} count={calendars.length} />
        ))}
      </div>
      <div className="cal-side-bottom">
        <Menu
          items={addItems}
          trigger={
            <Button variant="subtle" small icon={<Plus size={16} />}>
              Kalender hinzufügen
            </Button>
          }
        />
      </div>
    </aside>
  );
}
