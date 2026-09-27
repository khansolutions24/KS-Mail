// To-do lists, tasks and notes.

import type { Note, Task, TaskList } from '@shared/types';
import { defaultTaskList } from '@shared/defaults';
import { occurrenceStarts } from '@shared/recurrence';
import { newId } from '@shared/util';
import { emit } from '../events';
import type { Db } from '../store/db';
import type { MailService } from '../mail/service';

export function emptyTask(listId: string): Task {
  return {
    id: newId(),
    listId,
    title: '',
    notes: '',
    due: null,
    reminder: null,
    priority: 'normal',
    done: false,
    important: false,
    myDay: false,
    steps: [],
    recurrence: null,
    messageId: null,
    created: Date.now(),
    completedAt: null,
    sortOrder: Date.now()
  };
}

export class TaskService {
  constructor(
    private db: Db,
    private mail: MailService
  ) {
    if (!this.lists().length) this.saveList(defaultTaskList());
  }

  lists(): TaskList[] {
    return this.db.all<{ json: string }>('SELECT json FROM task_lists').map((r) => JSON.parse(r.json) as TaskList);
  }

  saveList(l: TaskList): TaskList {
    const list = { ...l, id: l.id || newId() };
    this.db.run('INSERT INTO task_lists(id, json) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json', list.id, JSON.stringify(list));
    emit('tasks:changed', null);
    return list;
  }

  removeList(id: string): void {
    if (this.lists().length <= 1) throw new Error('Die letzte Liste kann nicht gelöscht werden.');
    for (const t of this.list().filter((t) => t.listId === id)) this.db.run('DELETE FROM tasks WHERE id = ?', t.id);
    this.db.run('DELETE FROM task_lists WHERE id = ?', id);
    emit('tasks:changed', null);
  }

  list(): Task[] {
    return this.db.all<{ json: string }>('SELECT json FROM tasks').map((r) => JSON.parse(r.json) as Task);
  }

  save(t: Task): Task {
    const prev = t.id ? this.db.get<{ json: string }>('SELECT json FROM tasks WHERE id = ?', t.id) : undefined;
    const before = prev ? (JSON.parse(prev.json) as Task) : null;
    const task: Task = { ...t, id: t.id || newId() };
    if (task.done && !before?.done) {
      task.completedAt = Date.now();
      // recurring task: create the next instance
      if (task.recurrence && task.due) {
        const it = occurrenceStarts(task.due, task.recurrence);
        it.next();
        const next = it.next();
        if (!next.done) {
          const copy: Task = { ...task, id: newId(), done: false, completedAt: null, due: next.value, reminder: task.reminder ? task.reminder + (next.value - task.due) : null, steps: task.steps.map((s) => ({ ...s, done: false })), created: Date.now() };
          this.write(copy);
          task.recurrence = null;
        }
      }
    }
    if (!task.done) task.completedAt = null;
    this.write(task);
    emit('tasks:changed', null);
    return task;
  }

  private write(t: Task): void {
    this.db.run('INSERT INTO tasks(id, json) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json', t.id, JSON.stringify(t));
  }

  remove(id: string): void {
    this.db.run('DELETE FROM tasks WHERE id = ?', id);
    emit('tasks:changed', null);
  }

  fromMessage(messageId: number): Task {
    const h = this.mail.get(messageId);
    if (!h) throw new Error('Nachricht nicht gefunden.');
    const t = emptyTask(this.lists()[0].id);
    t.title = h.subject || '(Ohne Betreff)';
    t.notes = `Von: ${h.from.name || h.from.address}\n${h.snippet}`;
    t.messageId = messageId;
    const due = new Date();
    due.setHours(17, 0, 0, 0);
    t.due = due.getTime();
    return this.save(t);
  }

  notes(): Note[] {
    return this.db.all<{ json: string }>('SELECT json FROM notes').map((r) => JSON.parse(r.json) as Note).sort((a, b) => b.updated - a.updated);
  }

  saveNote(n: Note): Note {
    const note = { ...n, id: n.id || newId(), updated: Date.now() };
    this.db.run('INSERT INTO notes(id, json) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json', note.id, JSON.stringify(note));
    emit('notes:changed', null);
    return note;
  }

  removeNote(id: string): void {
    this.db.run('DELETE FROM notes WHERE id = ?', id);
    emit('notes:changed', null);
  }
}
