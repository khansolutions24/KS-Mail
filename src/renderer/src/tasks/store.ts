// Tasks module state: lists, tasks, flagged mails, current view and selection.

import { create } from 'zustand';
import { VIRTUAL, type MessageHeader, type Task, type TaskList } from '@shared/types';
import { api, errorMessage } from '../api/client';
import { attempt, toast } from '../store/app';
import type { ViewId } from './taskUtils';

const VIEW_KEY = 'tasks:view';

function initialView(): ViewId {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v) return v as ViewId;
  } catch {
    // storage unavailable
  }
  return 'myDay';
}

interface TasksState {
  lists: TaskList[];
  tasks: Task[];
  loaded: boolean;
  flagged: MessageHeader[];
  flaggedLoaded: boolean;
  view: ViewId;
  selectedId: string | null;

  load(): Promise<void>;
  loadFlagged(): Promise<void>;
  setView(v: ViewId): void;
  select(id: string | null): void;
  /** Optimistic save: updates local state first, then the backend */
  save(t: Task): Promise<Task | undefined>;
  remove(id: string): Promise<void>;
  saveList(l: TaskList): Promise<TaskList | undefined>;
  removeList(id: string): Promise<void>;
}

export const useTasks = create<TasksState>((set, get) => ({
  lists: [],
  tasks: [],
  loaded: false,
  flagged: [],
  flaggedLoaded: false,
  view: initialView(),
  selectedId: null,

  load: async () => {
    try {
      const [lists, tasks] = await Promise.all([api.tasks.lists(), api.tasks.list()]);
      const view = get().view;
      // fall back when the current list was deleted elsewhere
      const listGone = view.startsWith('list:') && !lists.some((l) => `list:${l.id}` === view);
      const sel = get().selectedId;
      set({ lists, tasks, loaded: true, selectedId: sel && tasks.some((t) => t.id === sel) ? sel : null, ...(listGone ? { view: 'myDay' as ViewId } : {}) });
    } catch (err) {
      toast('error', errorMessage(err));
    }
  },
  loadFlagged: async () => {
    try {
      const page = await api.mail.list({ folderId: VIRTUAL.flagged, limit: 200, sort: 'date', desc: true });
      set({ flagged: page.items, flaggedLoaded: true });
    } catch {
      set({ flagged: [], flaggedLoaded: true });
    }
  },
  setView: (view) => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // ignore
    }
    set({ view, selectedId: null });
  },
  select: (selectedId) => set({ selectedId }),
  save: async (t) => {
    const exists = get().tasks.some((x) => x.id === t.id);
    set({ tasks: exists ? get().tasks.map((x) => (x.id === t.id ? t : x)) : [...get().tasks, t] });
    try {
      const saved = await api.tasks.save(t);
      set({ tasks: get().tasks.map((x) => (x.id === saved.id ? saved : x)) });
      return saved;
    } catch (err) {
      toast('error', errorMessage(err));
      void get().load();
      return undefined;
    }
  },
  remove: async (id) => {
    const prev = get().tasks;
    set({ tasks: prev.filter((t) => t.id !== id), selectedId: get().selectedId === id ? null : get().selectedId });
    try {
      await api.tasks.remove(id);
    } catch (err) {
      set({ tasks: prev });
      toast('error', errorMessage(err));
    }
  },
  saveList: async (l) => {
    const saved = await attempt(() => api.tasks.saveList(l));
    if (saved) {
      const exists = get().lists.some((x) => x.id === saved.id);
      set({ lists: exists ? get().lists.map((x) => (x.id === saved.id ? saved : x)) : [...get().lists, saved] });
    }
    return saved;
  },
  removeList: async (id) => {
    const ok = await attempt(() => api.tasks.removeList(id).then(() => true));
    if (!ok) return;
    set({ lists: get().lists.filter((l) => l.id !== id), tasks: get().tasks.filter((t) => t.listId !== id) });
    if (get().view === `list:${id}`) get().setView('myDay');
  }
}));

/** Undoable delete with toast */
export async function deleteTask(t: Task): Promise<void> {
  await useTasks.getState().remove(t.id);
  toast('info', `„${t.title || 'Aufgabe'}“ gelöscht`, { label: 'Rückgängig', run: () => void useTasks.getState().save(t) });
}
