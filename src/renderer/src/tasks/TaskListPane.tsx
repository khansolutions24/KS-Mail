// Middle pane: quick add, open tasks (drag & drop reorder in real lists) and the collapsible "Erledigt" section.

import { CalendarDays, ChevronDown, ChevronRight, CircleCheck, Flag, ListTodo, Plus, Star, Sun, Infinity as AllIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { Task } from '@shared/types';
import { dayLabel } from '../lib/format';
import { Empty } from '../components/ui';
import { deleteTask, useTasks } from './store';
import { FlaggedMails } from './FlaggedMails';
import { TaskRow } from './TaskRow';
import { inView, listIdOf, newTask, smartDefaults, SMART_LISTS, sortDone, sortOpen, type SmartId, type ViewId } from './taskUtils';

const EMPTY_TEXT: Record<SmartId | 'list', { icon: ReactNode; title: string; text: string }> = {
  myDay: { icon: <Sun size={40} />, title: 'Konzentrieren Sie sich auf Ihren Tag', text: 'Fügen Sie Aufgaben hinzu, die Sie heute erledigen möchten. „Mein Tag“ gilt nur für heute.' },
  important: { icon: <Star size={40} />, title: 'Keine wichtigen Aufgaben', text: 'Markieren Sie Aufgaben mit dem Stern, um sie hier zu sammeln.' },
  planned: { icon: <CalendarDays size={40} />, title: 'Nichts geplant', text: 'Aufgaben mit Fälligkeitsdatum erscheinen hier, sortiert nach Datum.' },
  all: { icon: <AllIcon size={40} />, title: 'Keine offenen Aufgaben', text: 'Alle Aufgaben aus allen Listen werden hier angezeigt.' },
  done: { icon: <CircleCheck size={40} />, title: 'Noch nichts erledigt', text: 'Abgeschlossene Aufgaben werden hier gesammelt.' },
  flagged: { icon: <Flag size={40} />, title: '', text: '' },
  list: { icon: <ListTodo size={40} />, title: 'Diese Liste ist leer', text: 'Geben Sie oben eine Aufgabe ein und drücken Sie die Eingabetaste.' }
};

/** Delay before a checked task moves to "Erledigt", so the check animation is visible */
const COMPLETE_DELAY = 380;

function QuickAdd({ view, inputRef }: { view: ViewId; inputRef: RefObject<HTMLInputElement> }): JSX.Element {
  const [text, setText] = useState('');
  const add = (): void => {
    const title = text.trim();
    if (!title) return;
    const st = useTasks.getState();
    const listId = listIdOf(view) ?? st.lists[0]?.id;
    if (!listId) return;
    // new tasks go to the top of their list
    const min = Math.min(...st.tasks.filter((t) => t.listId === listId && !t.done).map((t) => t.sortOrder), Date.now());
    void st.save(newTask(listId, title, { ...smartDefaults(view), sortOrder: min - 1000 }));
    setText('');
  };
  return (
    <div className="task-quickadd">
      <Plus size={18} />
      <input
        ref={inputRef}
        className="grow"
        value={text}
        placeholder="Aufgabe hinzufügen"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add();
          else if (e.key === 'Escape') {
            setText('');
            e.currentTarget.blur();
          }
        }}
      />
      {text.trim() && (
        <button type="button" className="btn small" onClick={add}>
          Hinzufügen
        </button>
      )}
    </div>
  );
}

export function TaskListPane({ inputRef }: { inputRef: RefObject<HTMLInputElement> }): JSX.Element {
  const view = useTasks((s) => s.view);
  const tasks = useTasks((s) => s.tasks);
  const lists = useTasks((s) => s.lists);
  const loaded = useTasks((s) => s.loaded);
  const selectedId = useTasks((s) => s.selectedId);
  const [completing, setCompleting] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState(true);
  const [drag, setDrag] = useState<{ id: string; over: string | null; pos: 'before' | 'after' } | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const listId = listIdOf(view);
  const list = lists.find((l) => l.id === listId);
  const listNames = useMemo(() => new Map(lists.map((l) => [l.id, l.name])), [lists]);
  const smart = SMART_LISTS.find((s) => s.id === view);
  const title = list?.name ?? smart?.label ?? '';

  const inThisView = tasks.filter((t) => inView(t, view));
  const open = view === 'done' ? [] : sortOpen(inThisView.filter((t) => !t.done || completing.has(t.id)), view);
  // "Alle" leaves completed tasks to the "Erledigt" view; every other list gets a collapsible done section
  const done = view === 'done' ? sortDone(inThisView) : view === 'all' ? [] : sortDone(inThisView.filter((t) => t.done && !completing.has(t.id)));

  const toggleDone = (t: Task): void => {
    const st = useTasks.getState();
    if (t.done) {
      void st.save({ ...t, done: false });
      return;
    }
    setCompleting((s) => new Set(s).add(t.id));
    timers.current.push(
      window.setTimeout(() => {
        void st.save({ ...t, done: true }).finally(() =>
          setCompleting((s) => {
            const n = new Set(s);
            n.delete(t.id);
            return n;
          })
        );
      }, COMPLETE_DELAY)
    );
  };

  // ── drag & drop reordering (only within a real list) ──
  const onDragStart = (t: Task, e: DragEvent): void => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', t.title);
    setDrag({ id: t.id, over: null, pos: 'before' });
  };
  const onDragOver = (t: Task, e: DragEvent): void => {
    if (!drag) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const pos = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
    if (drag.over !== t.id || drag.pos !== pos) setDrag({ ...drag, over: t.id, pos });
  };
  const onDrop = (target: Task, e: DragEvent): void => {
    e.preventDefault();
    if (!drag || drag.id === target.id) return setDrag(null);
    const moving = open.find((t) => t.id === drag.id);
    const rest = open.filter((t) => t.id !== drag.id);
    let idx = rest.findIndex((t) => t.id === target.id);
    if (!moving || idx < 0) return setDrag(null);
    if (drag.pos === 'after') idx++;
    const prev = rest[idx - 1];
    const next = rest[idx];
    const sortOrder = prev && next ? (prev.sortOrder + next.sortOrder) / 2 : prev ? prev.sortOrder + 1000 : next ? next.sortOrder - 1000 : moving.sortOrder;
    setDrag(null);
    void useTasks.getState().save({ ...moving, sortOrder });
  };

  const renderRow = (t: Task, dnd: boolean): JSX.Element => (
    <TaskRow
      key={t.id}
      task={t}
      selected={t.id === selectedId}
      listName={listId ? undefined : listNames.get(t.listId)}
      showMyDay={view !== 'myDay'}
      completing={completing.has(t.id)}
      onSelect={() => useTasks.getState().select(t.id)}
      onToggleDone={() => toggleDone(t)}
      onToggleImportant={() => void useTasks.getState().save({ ...t, important: !t.important })}
      draggable={dnd}
      dropMark={drag && drag.over === t.id && drag.id !== t.id ? drag.pos : null}
      onDragStart={dnd ? (e) => onDragStart(t, e) : undefined}
      onDragOver={dnd ? (e) => onDragOver(t, e) : undefined}
      onDrop={dnd ? (e) => onDrop(t, e) : undefined}
      onDragEnd={() => setDrag(null)}
    />
  );

  // keyboard: arrows move the selection, Delete removes the selected task
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const rows = [...open, ...(view === 'done' || showDone ? done : [])];
    const idx = rows.findIndex((t) => t.id === selectedId);
    if (e.key === 'Delete' && idx >= 0) {
      e.preventDefault();
      void deleteTask(rows[idx]);
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && rows.length) {
      e.preventDefault();
      const next = Math.max(0, Math.min(rows.length - 1, idx < 0 ? 0 : idx + (e.key === 'ArrowDown' ? 1 : -1)));
      useTasks.getState().select(rows[next].id);
    }
  };

  const empty = EMPTY_TEXT[listId ? 'list' : (view as SmartId)];
  const canAdd = view !== 'done' && view !== 'flagged';
  return (
    <section className="pane task-main" style={list ? { ['--list-color' as string]: list.color } : undefined}>
      <div className="task-main-header">
        <h1 className="task-main-title">{title}</h1>
        {view === 'myDay' && <div className="task-main-sub">{dayLabel(Date.now())}</div>}
      </div>
      {canAdd && <QuickAdd view={view} inputRef={inputRef} />}
      <div className="pane-body task-main-body" tabIndex={-1} onKeyDown={onKeyDown}>
        {view === 'flagged' ? (
          <FlaggedMails />
        ) : (
          <>
            <div className="task-rows">{open.map((t) => renderRow(t, !!listId && !t.done))}</div>
            {loaded && !open.length && !done.length && (
              <Empty icon={empty.icon} title={empty.title}>
                {empty.text}
              </Empty>
            )}
            {done.length > 0 &&
              (view === 'done' ? (
                <div className="task-rows">{done.map((t) => renderRow(t, false))}</div>
              ) : (
                <>
                  <button type="button" className="task-done-toggle" onClick={() => setShowDone(!showDone)}>
                    {showDone ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    Erledigt ({done.length})
                  </button>
                  {showDone && <div className="task-rows">{done.map((t) => renderRow(t, false))}</div>}
                </>
              ))}
          </>
        )}
      </div>
    </section>
  );
}
