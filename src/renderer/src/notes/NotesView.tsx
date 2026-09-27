// Notes module (sticky notes): searchable grid of colored notes plus an editor panel.

import { Plus, Search, StickyNote, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Note } from '@shared/types';
import { onEvent } from '../api/client';
import { useIntentHandler } from '../store/intent';
import { Button, Empty, IconButton, Splitter, useSplit } from '../components/ui';
import { useDebouncedDraft } from '../tasks/useDebouncedDraft';
import { deleteNote, useNotes } from './store';
import { emptyNote, isBlank, matchesNote } from './noteUtils';
import { NoteCard } from './NoteCard';
import { NoteEditor } from './NoteEditor';

export function NotesView(): JSX.Element {
  const notes = useNotes((s) => s.notes);
  const loaded = useNotes((s) => s.loaded);
  const openId = useNotes((s) => s.openId);
  const [search, setSearch] = useState('');
  const [editorW, startEditor, dragEditor] = useSplit('notes-editor', 420, 300, 720);
  /** The open note was just created → focus its title instead of the body */
  const [fresh, setFresh] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const source = useMemo(() => notes.find((n) => n.id === openId) ?? null, [notes, openId]);
  // deleted notes are not re-created by a late debounced save
  const save = useCallback(async (n: Note) => (useNotes.getState().notes.some((x) => x.id === n.id) ? useNotes.getState().save(n) : undefined), []);
  const { draft, update, flush } = useDebouncedDraft(source, save, 500);

  // keep the latest draft reachable for close/switch handlers
  const draftRef = useRef<Note | null>(draft);
  draftRef.current = draft;

  /** Switches the open note; a note left completely empty is discarded */
  const openNote = useCallback(
    (id: string | null): void => {
      const cur = draftRef.current;
      if (cur && cur.id !== id) {
        flush();
        if (isBlank(cur)) void useNotes.getState().remove(cur.id);
      }
      useNotes.getState().open(id);
    },
    [flush]
  );

  const createNote = useCallback(async (): Promise<void> => {
    const n = emptyNote();
    setSearch('');
    openNote(null);
    const saved = await useNotes.getState().save(n);
    if (saved) {
      setFresh(true);
      useNotes.getState().open(saved.id);
    }
  }, [openNote]);

  useEffect(() => {
    void useNotes.getState().load();
    const off = onEvent('notes:changed', () => void useNotes.getState().load());
    const onSearch = (e: Event): void => setSearch((e as CustomEvent<string>).detail ?? '');
    window.addEventListener('ksmail:search', onSearch);
    return () => {
      off();
      window.removeEventListener('ksmail:search', onSearch);
    };
  }, []);

  // discard an empty open note when leaving the module
  useEffect(
    () => () => {
      const cur = draftRef.current;
      if (cur && isBlank(cur) && useNotes.getState().notes.some((n) => n.id === cur.id)) {
        void useNotes.getState().remove(cur.id);
      }
    },
    []
  );

  useIntentHandler('notes', (action) => {
    if (action === 'newNote') void createNote();
  });

  const visible = notes.filter((n) => matchesNote(n, search));

  return (
    <div className="notes-view">
      <section className="pane notes-main">
        <div className="notes-toolbar">
          <h1 className="notes-title">Notizen</h1>
          <div className="notes-search">
            <Search size={16} />
            <input
              ref={searchRef}
              className="grow"
              value={search}
              placeholder="Notizen durchsuchen"
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSearch('');
              }}
            />
            {search && (
              <IconButton small label="Suche löschen" onClick={() => setSearch('')}>
                <X size={14} />
              </IconButton>
            )}
          </div>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => void createNote()}>
            Neue Notiz
          </Button>
        </div>
        <div className="pane-body notes-body">
          {loaded && !notes.length && (
            <Empty icon={<StickyNote size={48} />} title="Noch keine Notizen">
              Halten Sie Ideen, Telefonnummern oder Einkaufslisten schnell fest.
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => void createNote()} style={{ marginTop: 8 }}>
                Erste Notiz erstellen
              </Button>
            </Empty>
          )}
          {notes.length > 0 && !visible.length && (
            <Empty icon={<Search size={40} />} title="Keine Treffer">
              Keine Notiz enthält „{search}“.
            </Empty>
          )}
          <div className="notes-grid">
            {visible.map((n) => {
              // the open note shows its live draft
              const shown = draft && draft.id === n.id ? draft : n;
              return (
                <NoteCard
                  key={n.id}
                  note={shown}
                  active={n.id === openId}
                  onOpen={() => {
                    setFresh(false);
                    openNote(n.id);
                  }}
                  onColor={(color) => (n.id === openId ? update({ color }, true) : void useNotes.getState().save({ ...n, color }))}
                  onDelete={() => void deleteNote(shown)}
                />
              );
            })}
          </div>
        </div>
      </section>
      {draft && (
        <>
          <Splitter onPointerDown={(e) => startEditor(e, true)} dragging={dragEditor} />
          <div style={{ width: editorW, flex: 'none', display: 'flex' }}>
            <NoteEditor note={draft} focusBody={!fresh} onChange={update} onClose={() => openNote(null)} onDelete={() => void deleteNote(draft)} />
          </div>
        </>
      )}
    </div>
  );
}
