// Notes module state.

import { create } from 'zustand';
import type { Note } from '@shared/types';
import { api, errorMessage } from '../api/client';
import { toast } from '../store/app';

interface NotesState {
  notes: Note[];
  loaded: boolean;
  openId: string | null;
  load(): Promise<void>;
  open(id: string | null): void;
  save(n: Note): Promise<Note | undefined>;
  remove(id: string): Promise<void>;
}

function sorted(list: Note[]): Note[] {
  return [...list].sort((a, b) => b.updated - a.updated);
}

export const useNotes = create<NotesState>((set, get) => ({
  notes: [],
  loaded: false,
  openId: null,

  load: async () => {
    try {
      const notes = await api.notes.list();
      set({ notes: sorted(notes), loaded: true });
    } catch (err) {
      toast('error', errorMessage(err));
    }
  },
  open: (openId) => set({ openId }),
  save: async (n) => {
    const local = { ...n, updated: Date.now() };
    const exists = get().notes.some((x) => x.id === n.id);
    set({ notes: sorted(exists ? get().notes.map((x) => (x.id === n.id ? local : x)) : [local, ...get().notes]) });
    try {
      const saved = await api.notes.save(n);
      set({ notes: sorted(get().notes.map((x) => (x.id === saved.id ? saved : x))) });
      return saved;
    } catch (err) {
      toast('error', errorMessage(err));
      return undefined;
    }
  },
  remove: async (id) => {
    const prev = get().notes;
    set({ notes: prev.filter((n) => n.id !== id), openId: get().openId === id ? null : get().openId });
    try {
      await api.notes.remove(id);
    } catch (err) {
      set({ notes: prev });
      toast('error', errorMessage(err));
    }
  }
}));

/** Deletes a note with an undo action */
export async function deleteNote(n: Note): Promise<void> {
  await useNotes.getState().remove(n.id);
  toast('info', 'Notiz gelöscht', { label: 'Rückgängig', run: () => void useNotes.getState().save(n) });
}
