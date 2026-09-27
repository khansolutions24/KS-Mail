// Editor panel for the open note (auto-saved by the parent via useDebouncedDraft).

import clsx from 'clsx';
import { Trash2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Note } from '@shared/types';
import { IconButton } from '../components/ui';
import { longDate } from '../lib/format';
import { NOTE_COLORS, noteColor } from './noteUtils';

export function NoteEditor({ note, focusBody, onChange, onClose, onDelete }: { note: Note; focusBody: boolean; onChange: (p: Partial<Note>, immediate?: boolean) => void; onClose: () => void; onDelete: () => void }): JSX.Element {
  const color = noteColor(note);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // focus: new notes start in the body, existing ones keep the caret at the end of the body
  useEffect(() => {
    const el = focusBody ? bodyRef.current : titleRef.current;
    el?.focus();
    if (el === bodyRef.current && el) el.setSelectionRange(el.value.length, el.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  return (
    <aside
      className={clsx('note-editor', `note-c-${color}`)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="note-editor-header">
        <div className="note-swatches" role="radiogroup" aria-label="Farbe">
          {NOTE_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={c.id === color}
              title={c.label}
              aria-label={c.label}
              className={clsx('note-swatch', `note-c-${c.id}`, c.id === color && 'active')}
              onClick={() => onChange({ color: c.id }, true)}
            />
          ))}
        </div>
        <span className="grow" />
        <IconButton label="Notiz löschen" onClick={onDelete}>
          <Trash2 size={18} />
        </IconButton>
        <IconButton label="Schließen (Esc)" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </header>
      <input
        ref={titleRef}
        className="note-editor-title"
        value={note.title}
        placeholder="Titel"
        onChange={(e) => onChange({ title: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.shiftKey)) {
            e.preventDefault();
            bodyRef.current?.focus();
          }
        }}
      />
      <textarea ref={bodyRef} className="note-editor-body" value={note.body} placeholder="Notiz schreiben …" onChange={(e) => onChange({ body: e.target.value })} />
      <footer className="note-editor-footer">Zuletzt geändert: {longDate(note.updated)}</footer>
    </aside>
  );
}
