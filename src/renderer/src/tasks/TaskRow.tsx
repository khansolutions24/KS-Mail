// A single task row (and the round completion checkbox shared with the detail panel).

import clsx from 'clsx';
import { Bell, CalendarDays, Check, FileText, Mail, Repeat, Star, Sun } from 'lucide-react';
import type { DragEvent, ReactNode } from 'react';
import type { Task } from '@shared/types';
import { dueLabel, isOverdue } from './taskUtils';

export function RoundCheck({ checked, onToggle, label, color }: { checked: boolean; onToggle: () => void; label?: string; color?: string }): JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label ?? (checked ? 'Als nicht erledigt markieren' : 'Als erledigt markieren')}
      title={label ?? (checked ? 'Als nicht erledigt markieren' : 'Als erledigt markieren')}
      className={clsx('round-check', checked && 'checked')}
      style={color ? { ['--check-color' as string]: color } : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <Check size={12} strokeWidth={3} />
    </button>
  );
}

function Meta({ icon, children, className }: { icon?: ReactNode; children?: ReactNode; className?: string }): JSX.Element {
  return (
    <span className={clsx('task-meta-item', className)}>
      {icon}
      {children}
    </span>
  );
}

export interface TaskRowProps {
  task: Task;
  selected: boolean;
  /** List name shown in smart lists */
  listName?: string;
  showMyDay: boolean;
  /** Checkbox shows as done while the completion animation runs */
  completing: boolean;
  onSelect(): void;
  onToggleDone(): void;
  onToggleImportant(): void;
  draggable?: boolean;
  dropMark?: 'before' | 'after' | null;
  onDragStart?(e: DragEvent): void;
  onDragOver?(e: DragEvent): void;
  onDrop?(e: DragEvent): void;
  onDragEnd?(): void;
}

export function TaskRow(p: TaskRowProps): JSX.Element {
  const t = p.task;
  const doneSteps = t.steps.filter((s) => s.done).length;
  const meta: ReactNode[] = [];
  if (p.listName) meta.push(<Meta key="list">{p.listName}</Meta>);
  if (p.showMyDay && t.myDay && !t.done) meta.push(<Meta key="myday" icon={<Sun size={12} />}>Mein Tag</Meta>);
  if (t.steps.length) meta.push(<Meta key="steps">{`${doneSteps} von ${t.steps.length}`}</Meta>);
  if (t.due !== null)
    meta.push(
      <Meta key="due" icon={<CalendarDays size={12} />} className={isOverdue(t) ? 'overdue' : undefined}>
        {dueLabel(t.due)}
      </Meta>
    );
  if (t.reminder !== null && !t.done) meta.push(<Meta key="rem" icon={<Bell size={12} />} />);
  if (t.recurrence) meta.push(<Meta key="rec" icon={<Repeat size={12} />} />);
  if (t.notes.trim()) meta.push(<Meta key="notes" icon={<FileText size={12} />} />);
  if (t.messageId !== null) meta.push(<Meta key="mail" icon={<Mail size={12} />} />);

  const done = t.done || p.completing;
  return (
    <div
      className={clsx('task-row', p.selected && 'selected', done && 'done', p.completing && 'completing', p.dropMark && `drop-${p.dropMark}`)}
      data-id={t.id}
      onClick={p.onSelect}
      draggable={p.draggable}
      onDragStart={p.onDragStart}
      onDragOver={p.onDragOver}
      onDrop={p.onDrop}
      onDragEnd={p.onDragEnd}
    >
      <RoundCheck checked={done} onToggle={p.onToggleDone} />
      <div className="grow task-row-main">
        <div className="task-row-title ellipsis">{t.title || '(Ohne Titel)'}</div>
        {meta.length > 0 && <div className="task-meta">{meta.map((m, i) => [i > 0 && <span key={`sep${i}`} className="task-meta-sep">·</span>, m])}</div>}
      </div>
      {t.priority === 'high' && !done && <span className="task-prio" title="Hohe Priorität">!</span>}
      <button
        type="button"
        className={clsx('task-star', t.important && 'on')}
        title={t.important ? 'Wichtig entfernen' : 'Als wichtig markieren'}
        aria-label={t.important ? 'Wichtig entfernen' : 'Als wichtig markieren'}
        onClick={(e) => {
          e.stopPropagation();
          p.onToggleImportant();
        }}
      >
        <Star size={16} fill={t.important ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
}
