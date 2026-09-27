// Global application state: module navigation, settings, accounts, folders, sync state, dialogs, toasts, composers.

import { create } from 'zustand';
import type { Account, Draft, Folder, Settings, SyncState } from '@shared/types';
import { api, errorMessage } from '../api/client';

export type Module = 'mail' | 'calendar' | 'contacts' | 'tasks' | 'notes' | 'settings';

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
  action?: { label: string; run: () => void };
}

export interface PromptState {
  title: string;
  label?: string;
  value: string;
  okLabel?: string;
  resolve: (v: string | null) => void;
}

export interface ConfirmState {
  title: string;
  text: string;
  okLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

export type Overlay =
  | { kind: 'palette'; mode?: 'commands' | 'search' }
  | { kind: 'folderPicker'; title: string; resolve: (folderId: string | null) => void; accountId?: string }
  | { kind: 'shortcuts' }
  | { kind: 'outbox' }
  | { kind: 'source'; messageId: number }
  | { kind: 'snooze'; ids: number[] }
  | null;

interface AppState {
  module: Module;
  settingsSection: string;
  settings: Settings | null;
  accounts: Account[];
  folders: Folder[];
  sync: Record<string, SyncState>;
  toasts: Toast[];
  prompt: PromptState | null;
  confirm: ConfirmState | null;
  overlay: Overlay;
  showFolders: boolean;
  /** Open composers (drafts being edited); the active one is shown in the reading area */
  composers: Draft[];
  activeComposer: string | null;
  outboxCount: number;

  setModule(m: Module): void;
  openSettings(section?: string): void;
  loadSettings(): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  loadAccounts(): Promise<void>;
  loadFolders(): Promise<void>;
  setSync(s: SyncState): void;
  toast(kind: Toast['kind'], text: string, action?: Toast['action']): void;
  dismissToast(id: number): void;
  setOverlay(o: Overlay): void;
  toggleFolders(): void;
  openComposer(d: Draft): void;
  updateComposer(d: Draft): void;
  closeComposer(id: string): void;
  setActiveComposer(id: string | null): void;
}

let toastSeq = 0;

export const useApp = create<AppState>((set, get) => ({
  module: 'mail',
  settingsSection: 'accounts',
  settings: null,
  accounts: [],
  folders: [],
  sync: {},
  toasts: [],
  prompt: null,
  confirm: null,
  overlay: null,
  showFolders: true,
  composers: [],
  activeComposer: null,
  outboxCount: 0,

  setModule: (module) => set({ module }),
  openSettings: (section) => set({ module: 'settings', settingsSection: section ?? get().settingsSection }),
  loadSettings: async () => set({ settings: await api.settings.get() }),
  updateSettings: async (patch) => {
    const prev = get().settings;
    if (prev) set({ settings: { ...prev, ...patch } as Settings });
    try {
      set({ settings: await api.settings.update(patch) });
    } catch (err) {
      set({ settings: prev });
      get().toast('error', errorMessage(err));
    }
  },
  loadAccounts: async () => set({ accounts: await api.accounts.list() }),
  loadFolders: async () => set({ folders: await api.mail.folders() }),
  setSync: (s) => set({ sync: { ...get().sync, [s.accountId]: s } }),
  toast: (kind, text, action) => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts.slice(-3), { id, kind, text, action }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : action ? 7000 : 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setOverlay: (overlay) => set({ overlay }),
  toggleFolders: () => set({ showFolders: !get().showFolders }),
  openComposer: (d) => {
    const exists = get().composers.some((c) => c.id === d.id);
    set({ composers: exists ? get().composers.map((c) => (c.id === d.id ? d : c)) : [...get().composers, d], activeComposer: d.id, module: 'mail' });
  },
  updateComposer: (d) => set({ composers: get().composers.map((c) => (c.id === d.id ? d : c)) }),
  closeComposer: (id) => {
    const rest = get().composers.filter((c) => c.id !== id);
    set({ composers: rest, activeComposer: get().activeComposer === id ? null : get().activeComposer });
  },
  setActiveComposer: (activeComposer) => set({ activeComposer })
}));

export function toast(kind: Toast['kind'], text: string, action?: Toast['action']): void {
  useApp.getState().toast(kind, text, action);
}

export function prompt(title: string, value = '', label?: string, okLabel?: string): Promise<string | null> {
  return new Promise((resolve) => useApp.setState({ prompt: { title, value, label, okLabel, resolve } }));
}

export function confirm(title: string, text: string, okLabel?: string, danger?: boolean): Promise<boolean> {
  return new Promise((resolve) => useApp.setState({ confirm: { title, text, okLabel, danger, resolve } }));
}

export function pickFolder(title: string, accountId?: string): Promise<string | null> {
  return new Promise((resolve) => useApp.setState({ overlay: { kind: 'folderPicker', title, resolve, accountId } }));
}

/** Runs an async action and reports errors as toast */
export async function attempt<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const r = await fn();
    if (success) toast('success', success);
    return r;
  } catch (err) {
    toast('error', errorMessage(err));
    return undefined;
  }
}

/** Like attempt() for actions without a result: true on success, errors are shown as toast */
export async function succeeded(fn: () => Promise<unknown>, success?: string): Promise<boolean> {
  try {
    await fn();
    if (success) toast('success', success);
    return true;
  } catch (err) {
    toast('error', errorMessage(err));
    return false;
  }
}

export function accountById(id: string): Account | undefined {
  return useApp.getState().accounts.find((a) => a.id === id);
}

export function folderById(id: string): Folder | undefined {
  return useApp.getState().folders.find((f) => f.id === id);
}
