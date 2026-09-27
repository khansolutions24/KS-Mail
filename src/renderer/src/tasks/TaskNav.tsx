// Left pane of the tasks module: smart lists and the user's task lists.

import clsx from 'clsx';
import { CalendarDays, CircleCheck, Flag, Infinity as AllIcon, ListTodo, Palette, Pencil, Plus, Star, Sun, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TaskList } from '@shared/types';
import { colorFor, newId } from '@shared/util';
import { confirm, prompt } from '../store/app';
import { ContextMenu, type MenuEntry } from '../components/ui';
import { useTasks } from './store';
import { inView, SMART_LISTS, type SmartId, type ViewId } from './taskUtils';

const SMART_ICONS: Record<SmartId, ReactNode> = {
  myDay: <Sun size={18} />,
  important: <Star size={18} />,
  planned: <CalendarDays size={18} />,
  all: <AllIcon size={18} />,
  done: <CircleCheck size={18} />,
  flagged: <Flag size={18} />
};

const LIST_COLORS: { color: string; name: string }[] = [
  { color: '#0f6cbd', name: 'Blau' },
  { color: '#8764b8', name: 'Lavendel' },
  { color: '#c239b3', name: 'Orchidee' },
  { color: '#e3008c', name: 'Pink' },
  { color: '#d13438', name: 'Rot' },
  { color: '#ca5010', name: 'Orange' },
  { color: '#c19c00', name: 'Gold' },
  { color: '#498205', name: 'Grün' },
  { color: '#038387', name: 'Petrol' },
  { color: '#69797e', name: 'Grau' }
];

function useCount(view: ViewId): number {
  return useTasks((s) => {
    if (view === 'flagged') return s.flagged.length;
    if (view === 'done') return 0;
    return s.tasks.filter((t) => !t.done && inView(t, view)).length;
  });
}

function NavRow({ view, icon, label, color }: { view: ViewId; icon: ReactNode; label: string; color?: string }): JSX.Element {
  const active = useTasks((s) => s.view === view);
  const count = useCount(view);
  return (
    <div className={clsx('nav-item', active && 'active')} onClick={() => useTasks.getState().setView(view)} style={color ? { ['--list-color' as string]: color } : undefined}>
      <span className="task-nav-icon" style={color ? { color } : undefined}>
        {icon}
      </span>
      <span className="grow ellipsis">{label}</span>
      {count > 0 && <span className="task-nav-count">{count}</span>}
    </div>
  );
}

function listMenu(l: TaskList): MenuEntry[] {
  const st = useTasks.getState();
  return [
    {
      label: 'Umbenennen',
      icon: <Pencil size={16} />,
      onSelect: async () => {
        const name = (await prompt('Liste umbenennen', l.name, 'Name', 'Umbenennen'))?.trim();
        if (name) await st.saveList({ ...l, name });
      }
    },
    {
      label: 'Farbe',
      icon: <Palette size={16} />,
      children: LIST_COLORS.map((c) => ({ label: c.name + (c.color.toLowerCase() === l.color.toLowerCase() ? ' ✓' : ''), swatch: c.color, onSelect: () => void st.saveList({ ...l, color: c.color }) }))
    },
    { separator: true },
    {
      label: 'Liste löschen',
      icon: <Trash2 size={16} />,
      danger: true,
      onSelect: async () => {
        const n = st.tasks.filter((t) => t.listId === l.id).length;
        const text = n ? `„${l.name}“ und ${n} ${n === 1 ? 'Aufgabe' : 'Aufgaben'} werden endgültig gelöscht.` : `„${l.name}“ wird gelöscht.`;
        if (await confirm('Liste löschen', text, 'Löschen', true)) await st.removeList(l.id);
      }
    }
  ];
}

export async function createList(): Promise<void> {
  const name = (await prompt('Neue Liste', '', 'Name', 'Erstellen'))?.trim();
  if (!name) return;
  const saved = await useTasks.getState().saveList({ id: newId(), name, color: colorFor(name) });
  if (saved) useTasks.getState().setView(`list:${saved.id}`);
}

export function TaskNav(): JSX.Element {
  const lists = useTasks((s) => s.lists);
  return (
    <aside className="pane pane-side task-nav">
      <div className="pane-body">
        <div className="nav-list">
          {SMART_LISTS.map((s) => (
            <NavRow key={s.id} view={s.id} icon={SMART_ICONS[s.id]} label={s.label} />
          ))}
        </div>
        <div className="task-nav-sep" />
        <div className="nav-list">
          {lists.map((l) => (
            <ContextMenu key={l.id} items={() => listMenu(l)}>
              <div>
                <NavRow view={`list:${l.id}`} icon={<ListTodo size={18} />} label={l.name} color={l.color} />
              </div>
            </ContextMenu>
          ))}
        </div>
      </div>
      <button type="button" className="task-new-list" onClick={() => void createList()}>
        <Plus size={18} />
        Neue Liste
      </button>
    </aside>
  );
}
