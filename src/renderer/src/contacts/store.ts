// Contacts module state: loaded contacts, navigation filter, search text and multi-selection.

import { create } from 'zustand';
import type { Contact } from '@shared/types';
import { api } from '../api/client';
import { attempt, confirm } from '../store/app';
import { contactName } from '@shared/vcard';
import type { ContactFilter } from './contactUtils';

interface ContactsState {
  contacts: Contact[];
  loaded: boolean;
  filter: ContactFilter;
  search: string;
  selected: string[];
  /** Anchor for Shift-click range selection */
  anchor: string | null;
  /** Contact being edited in the editor dialog (new or existing) */
  editing: Contact | null;

  load(): Promise<void>;
  setFilter(f: ContactFilter): void;
  setSearch(s: string): void;
  select(ids: string[], anchor?: string | null): void;
  edit(c: Contact | null): void;
  save(c: Contact): Promise<Contact | undefined>;
  toggleFavorite(ids: string[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
}

export const useContacts = create<ContactsState>((set, get) => ({
  contacts: [],
  loaded: false,
  filter: { kind: 'all' },
  search: '',
  selected: [],
  anchor: null,
  editing: null,

  load: async () => {
    const contacts = await attempt(() => api.contacts.list());
    if (!contacts) return;
    const ids = new Set(contacts.map((c) => c.id));
    set({ contacts, loaded: true, selected: get().selected.filter((id) => ids.has(id)) });
  },
  setFilter: (filter) => set({ filter, selected: [], anchor: null }),
  setSearch: (search) => set({ search }),
  select: (selected, anchor) => set({ selected, anchor: anchor === undefined ? get().anchor : anchor }),
  edit: (editing) => set({ editing }),
  save: async (c) => {
    const saved = await attempt(() => api.contacts.save({ ...c, updated: Date.now() }));
    if (saved) {
      const exists = get().contacts.some((x) => x.id === saved.id);
      set({ contacts: exists ? get().contacts.map((x) => (x.id === saved.id ? saved : x)) : [...get().contacts, saved] });
    }
    return saved;
  },
  toggleFavorite: async (ids) => {
    const list = get().contacts.filter((c) => ids.includes(c.id));
    // if any is not a favorite, mark all; otherwise unmark all
    const fav = list.some((c) => !c.favorite);
    for (const c of list) await get().save({ ...c, favorite: fav });
  },
  remove: async (ids) => {
    const list = get().contacts.filter((c) => ids.includes(c.id));
    if (!list.length) return;
    const text = list.length === 1 ? `„${contactName(list[0])}“ wird endgültig gelöscht.` : `${list.length} Kontakte werden endgültig gelöscht.`;
    if (!(await confirm(list.length === 1 ? 'Kontakt löschen' : 'Kontakte löschen', text, 'Löschen', true))) return;
    const ok = await attempt(() => api.contacts.remove(ids).then(() => true));
    if (ok) set({ contacts: get().contacts.filter((c) => !ids.includes(c.id)), selected: get().selected.filter((id) => !ids.includes(id)) });
  }
}));
