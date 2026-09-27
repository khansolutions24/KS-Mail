// Message list state: current folder, filters, search, loaded page, selection.

import { create } from 'zustand';
import type { MessageHeader, MessageQuery, SortField } from '@shared/types';
import { VIRTUAL } from '@shared/types';
import { api, errorMessage } from '../api/client';
import { toast } from './app';

const PAGE = 300;

interface MailState {
  folderId: string;
  filter: NonNullable<MessageQuery['filter']>;
  search: string;
  serverResults: MessageHeader[] | null;
  sort: SortField;
  desc: boolean;
  category: string | null;
  items: MessageHeader[];
  total: number;
  loading: boolean;
  selected: number[];
  focusedId: number | null;
  anchorId: number | null;
  /** Rows the user expanded in conversation view */
  expandedThreads: string[];

  setFolder(id: string): void;
  setFilter(f: MailState['filter']): void;
  setSearch(s: string): void;
  setServerResults(r: MessageHeader[] | null): void;
  setSort(s: SortField, desc?: boolean): void;
  setCategory(c: string | null): void;
  load(): Promise<void>;
  loadMore(): Promise<void>;
  select(id: number, mode?: 'single' | 'toggle' | 'range'): void;
  selectAll(): void;
  clearSelection(): void;
  moveFocus(delta: number, extend?: boolean): void;
  patchLocal(ids: number[], patch: Partial<MessageHeader>): void;
  removeLocal(ids: number[]): void;
  toggleThread(key: string): void;
}

let loadSeq = 0;

export const useMail = create<MailState>((set, get) => ({
  folderId: VIRTUAL.unifiedInbox,
  filter: 'all',
  search: '',
  serverResults: null,
  sort: 'date',
  desc: true,
  category: null,
  items: [],
  total: 0,
  loading: false,
  selected: [],
  focusedId: null,
  anchorId: null,
  expandedThreads: [],

  setFolder: (folderId) => {
    set({ folderId, selected: [], focusedId: null, anchorId: null, serverResults: null, items: [], total: 0, category: null });
    void get().load();
  },
  setFilter: (filter) => {
    set({ filter });
    void get().load();
  },
  setSearch: (search) => {
    set({ search, serverResults: null });
    void get().load();
  },
  setServerResults: (serverResults) => set({ serverResults }),
  setSort: (sort, desc) => {
    set({ sort, desc: desc ?? (sort === 'date' || sort === 'size' || sort === 'flagged') });
    void get().load();
  },
  setCategory: (category) => {
    set({ category });
    void get().load();
  },
  load: async () => {
    const seq = ++loadSeq;
    const s = get();
    set({ loading: true });
    try {
      const page = await api.mail.list({ folderId: s.folderId, filter: s.filter, search: s.search, sort: s.sort, desc: s.desc, category: s.category ?? undefined, limit: Math.max(PAGE, s.items.length), offset: 0 });
      if (seq !== loadSeq) return;
      const ids = new Set(page.items.map((m) => m.id));
      const selected = get().selected.filter((id) => ids.has(id));
      const focusedId = get().focusedId;
      set({ items: page.items, total: page.total, loading: false, selected, focusedId: focusedId !== null && (ids.has(focusedId) || get().serverResults) ? focusedId : selected[0] ?? null });
    } catch (err) {
      if (seq === loadSeq) set({ loading: false });
      toast('error', errorMessage(err));
    }
  },
  loadMore: async () => {
    const s = get();
    if (s.loading) return;
    if (s.items.length >= s.total) {
      // everything cached locally is shown: fetch older messages from the server
      if (!s.folderId.startsWith('virtual:') && !s.search) {
        set({ loading: true });
        try {
          const n = await api.mail.loadMore(s.folderId);
          set({ loading: false });
          if (n) await get().load();
        } catch (err) {
          set({ loading: false });
          toast('error', errorMessage(err));
        }
      }
      return;
    }
    set({ loading: true });
    try {
      const page = await api.mail.list({ folderId: s.folderId, filter: s.filter, search: s.search, sort: s.sort, desc: s.desc, category: s.category ?? undefined, limit: PAGE, offset: s.items.length });
      const known = new Set(get().items.map((m) => m.id));
      set({ items: [...get().items, ...page.items.filter((m) => !known.has(m.id))], total: page.total, loading: false });
    } catch {
      set({ loading: false });
    }
  },
  select: (id, mode = 'single') => {
    const s = get();
    const list = visibleList();
    if (mode === 'toggle') {
      const sel = s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id];
      set({ selected: sel, focusedId: sel.length === 1 ? sel[0] : id, anchorId: id });
      return;
    }
    if (mode === 'range' && s.anchorId !== null) {
      const a = list.findIndex((m) => m.id === s.anchorId);
      const b = list.findIndex((m) => m.id === id);
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a];
        set({ selected: list.slice(from, to + 1).map((m) => m.id), focusedId: id });
        return;
      }
    }
    set({ selected: [id], focusedId: id, anchorId: id });
  },
  selectAll: () => set({ selected: visibleList().map((m) => m.id) }),
  clearSelection: () => set({ selected: [], focusedId: null }),
  moveFocus: (delta, extend) => {
    const list = visibleList();
    if (!list.length) return;
    const cur = list.findIndex((m) => m.id === get().focusedId);
    const next = list[Math.min(list.length - 1, Math.max(0, cur < 0 ? 0 : cur + delta))];
    if (!next) return;
    if (extend) get().select(next.id, 'range');
    else get().select(next.id);
    if (list.indexOf(next) > list.length - 20) void get().loadMore();
  },
  patchLocal: (ids, patch) => {
    const set_ = new Set(ids);
    set({
      items: get().items.map((m) => (set_.has(m.id) ? { ...m, ...patch } : m)),
      serverResults: get().serverResults?.map((m) => (set_.has(m.id) ? { ...m, ...patch } : m)) ?? null
    });
  },
  removeLocal: (ids) => {
    const set_ = new Set(ids);
    const list = visibleList();
    // focus moves to the next message (Outlook behaviour)
    const idx = list.findIndex((m) => set_.has(m.id));
    const rest = list.filter((m) => !set_.has(m.id));
    const next = rest[Math.min(idx, rest.length - 1)] ?? null;
    set({
      items: get().items.filter((m) => !set_.has(m.id)),
      serverResults: get().serverResults?.filter((m) => !set_.has(m.id)) ?? null,
      total: Math.max(0, get().total - ids.length),
      selected: next ? [next.id] : [],
      focusedId: next?.id ?? null,
      anchorId: next?.id ?? null
    });
  },
  toggleThread: (key) => {
    const e = get().expandedThreads;
    set({ expandedThreads: e.includes(key) ? e.filter((k) => k !== key) : [...e, key] });
  }
}));

/** The list as shown (server search results replace the local list) */
export function visibleList(): MessageHeader[] {
  const s = useMail.getState();
  return s.serverResults ?? s.items;
}

export function selectedMessages(): MessageHeader[] {
  const s = useMail.getState();
  const ids = new Set(s.selected.length ? s.selected : s.focusedId !== null ? [s.focusedId] : []);
  return visibleList().filter((m) => ids.has(m.id));
}
