// Right pane: editor for the selected task (changes are saved automatically).

import clsx from 'clsx';
import { Bell, CalendarDays, Mail, PanelRightClose, Plus, Repeat, Star, Sun, Trash2, X, ListTodo } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Task } from '@shared/types';
import { newId } from '@shared/util';
import { describeRecurrence } from '@shared/recurrence';
import { addDays, fromInputDateTime, fromInputs, longDate, startOfDay, toInputDate, toInputDateTime } from '../lib/format';
import { runCommand } from '../lib/commands';
import { IconButton } from '../components/ui';
import { deleteTask, useTasks } from './store';
import { RoundCheck } from './TaskRow';
import { dueLabel, isOverdue, nextWeek, presetOf, PRIORITY_LABELS, RECURRENCE_OPTIONS, recurrenceFor, type RecurrencePreset } from './taskUtils';
import { useDebouncedDraft } from './useDebouncedDraft';

/** Textarea that grows with its content */
function AutoText({ value, onChange, className, placeholder, onEnter }: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string; onEnter?: () => void }): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={className}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(onEnter ? e.target.value.replace(/\n/g, ' ') : e.target.value)}
      onKeyDown={(e) => {
        if (onEnter && e.key === 'Enter') {
          e.preventDefault();
          onEnter();
        }
      }}
    />
  );
}

function Steps({ task, update }: { task: Task; update: (p: Partial<Task>, immediate?: boolean) => void }): JSX.Element {
  const [text, setText] = useState('');
  const setStep = (id: string, patch: Partial<Task['steps'][number]>, immediate = false): void => update({ steps: task.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) }, immediate);
  const add = (): void => {
    const title = text.trim();
    if (!title) return;
    update({ steps: [...task.steps, { id: newId(), title, done: false }] }, true);
    setText('');
  };
  return (
    <div className="task-steps">
      {task.steps.map((s) => (
        <div key={s.id} className={clsx('task-step', s.done && 'done')}>
          <RoundCheck checked={s.done} onToggle={() => setStep(s.id, { done: !s.done }, true)} label={s.done ? 'Schritt nicht erledigt' : 'Schritt erledigt'} />
          <input className="grow task-step-input" value={s.title} onChange={(e) => setStep(s.id, { title: e.target.value })} />
          <IconButton small label="Schritt entfernen" onClick={() => update({ steps: task.steps.filter((x) => x.id !== s.id) }, true)}>
            <X size={14} />
          </IconButton>
        </div>
      ))}
      <div className="task-step add">
        <Plus size={16} className="task-step-plus" />
        <input
          className="grow task-step-input"
          value={text}
          placeholder={task.steps.length ? 'Nächster Schritt' : 'Schritt hinzufügen'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          onBlur={add}
        />
      </div>
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }): JSX.Element {
  return <div className={clsx('task-card', className)}>{children}</div>;
}

export function TaskDetail(): JSX.Element | null {
  const selectedId = useTasks((s) => s.selectedId);
  const source = useTasks((s) => s.tasks.find((t) => t.id === s.selectedId) ?? null);
  const lists = useTasks((s) => s.lists);
  // deleted tasks are not re-created by a late debounced save
  const save = useCallback(async (t: Task) => (useTasks.getState().tasks.some((x) => x.id === t.id) ? useTasks.getState().save(t) : undefined), []);
  const { draft: t, update } = useDebouncedDraft(source, save, 600);

  if (!selectedId || !t) return null;
  const preset = presetOf(t.recurrence);

  const setDue = (due: number | null): void => update({ due, ...(due === null ? { recurrence: null } : {}) }, true);
  const setRecurrence = (p: RecurrencePreset): void => {
    const recurrence = recurrenceFor(p);
    // a repeating task needs a due date to calculate the next occurrence
    update({ recurrence, ...(recurrence && t.due === null ? { due: startOfDay(Date.now()) } : {}) }, true);
  };

  return (
    <aside className="pane task-detail">
      <div className="task-detail-body">
        <Card className="task-title-card">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <RoundCheck checked={t.done} onToggle={() => update({ done: !t.done }, true)} />
            <AutoText className={clsx('task-title-input grow', t.done && 'done')} value={t.title} placeholder="Titel der Aufgabe" onChange={(title) => update({ title })} onEnter={() => (document.activeElement as HTMLElement | null)?.blur()} />
            <button type="button" className={clsx('task-star', t.important && 'on')} title={t.important ? 'Wichtig entfernen' : 'Als wichtig markieren'} onClick={() => update({ important: !t.important }, true)}>
              <Star size={18} fill={t.important ? 'currentColor' : 'none'} />
            </button>
          </div>
          <Steps task={t} update={update} />
        </Card>

        <Card>
          <button type="button" className={clsx('task-option', t.myDay && 'active')} onClick={() => update({ myDay: !t.myDay }, true)}>
            <Sun size={18} />
            <span className="grow">{t.myDay ? 'Zu „Mein Tag“ hinzugefügt' : 'Zu „Mein Tag“ hinzufügen'}</span>
            {t.myDay && <X size={16} />}
          </button>
        </Card>

        <Card>
          <div className="task-field">
            <CalendarDays size={18} className={clsx('task-field-icon', isOverdue(t) && 'overdue')} />
            <div className="grow col" style={{ gap: 6 }}>
              <div className="row">
                <span className={clsx('grow', t.due !== null && 'task-field-value', isOverdue(t) && 'overdue')}>{t.due !== null ? `Fällig: ${dueLabel(t.due)}` : 'Fälligkeitsdatum hinzufügen'}</span>
                {t.due !== null && (
                  <IconButton small label="Fälligkeit entfernen" onClick={() => setDue(null)}>
                    <X size={14} />
                  </IconButton>
                )}
              </div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                <button type="button" className="chip task-chip" onClick={() => setDue(startOfDay(Date.now()))}>
                  Heute
                </button>
                <button type="button" className="chip task-chip" onClick={() => setDue(addDays(startOfDay(Date.now()), 1))}>
                  Morgen
                </button>
                <button type="button" className="chip task-chip" onClick={() => setDue(nextWeek())}>
                  Nächste Woche
                </button>
                <input className="input task-date" type="date" value={t.due !== null ? toInputDate(t.due) : ''} onChange={(e) => setDue(e.target.value ? fromInputs(e.target.value) : null)} aria-label="Fälligkeitsdatum" />
              </div>
            </div>
          </div>
          <div className="task-field">
            <Bell size={18} className="task-field-icon" />
            <div className="grow row">
              <input className="input grow" type="datetime-local" value={t.reminder !== null ? toInputDateTime(t.reminder) : ''} onChange={(e) => update({ reminder: e.target.value ? fromInputDateTime(e.target.value) : null }, true)} aria-label="Erinnerung" />
              {t.reminder !== null && (
                <IconButton small label="Erinnerung entfernen" onClick={() => update({ reminder: null }, true)}>
                  <X size={14} />
                </IconButton>
              )}
            </div>
          </div>
          <div className="task-field">
            <Repeat size={18} className="task-field-icon" />
            <select className="select grow" value={preset} onChange={(e) => setRecurrence(e.target.value as RecurrencePreset)} aria-label="Wiederholung">
              {preset === 'custom' && <option value="custom">{describeRecurrence(t.recurrence)}</option>}
              {RECURRENCE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </Card>

        <Card>
          <div className="task-field">
            <span className="task-field-label">Priorität</span>
            <select className="select grow" value={t.priority} onChange={(e) => update({ priority: e.target.value as Task['priority'] }, true)}>
              {(Object.keys(PRIORITY_LABELS) as Task['priority'][]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="task-field">
            <ListTodo size={18} className="task-field-icon" />
            <select className="select grow" value={t.listId} onChange={(e) => update({ listId: e.target.value }, true)} aria-label="Liste">
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </Card>

        {t.messageId !== null && (
          <Card>
            <button type="button" className="task-option" onClick={() => void runCommand('open.message', String(t.messageId))}>
              <Mail size={18} />
              <span className="grow">Verknüpfte E-Mail öffnen</span>
            </button>
          </Card>
        )}

        <Card>
          <AutoText className="task-notes" value={t.notes} placeholder="Notiz hinzufügen" onChange={(notes) => update({ notes })} />
        </Card>
      </div>

      <footer className="task-detail-footer">
        <IconButton label="Detailansicht schließen" onClick={() => useTasks.getState().select(null)}>
          <PanelRightClose size={18} />
        </IconButton>
        <span className="grow muted small-text task-detail-info">{t.done && t.completedAt ? `Erledigt am ${longDate(t.completedAt)}` : `Erstellt am ${longDate(t.created)}`}</span>
        <IconButton label="Aufgabe löschen" onClick={() => void deleteTask(t)}>
          <Trash2 size={18} />
        </IconButton>
      </footer>
    </aside>
  );
}
