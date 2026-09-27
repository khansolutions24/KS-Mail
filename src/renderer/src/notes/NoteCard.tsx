// A sticky note card in the grid.

import clsx from 'clsx';
import { Palette, Trash2 } from 'lucide-react';
import type { Note } from '@shared/types';
import { ContextMenu, type MenuEntry } from '../components/ui';
import { NOTE_COLORS, noteColor, noteHeading, relativeDate, type NoteColor } from './noteUtils';

export function NoteCard({ note, active, onOpen, onColor, onDelete }: { note: Note; active: boolean; onOpen: () => void; onColor: (c: NoteColor) => void; onDelete: () => void }): JSX.Element {
  const color = noteColor(note);
  const heading = noteHeading(note);
  // without explicit title the first body line is the heading, so skip it in the preview
  const preview = note.title.trim() ? note.body.trim() : note.body.trim().split('\n').slice(1).join('\n').trim();
  const menu: MenuEntry[] = [
    { label: 'Öffnen', onSelect: onOpen },
    { label: 'Farbe', icon: <Palette size={16} />, children: NOTE_COLORS.map((c) => ({ label: c.label + (c.id === color ? ' ✓' : ''), swatch: `var(--note-swatch-${c.id})`, onSelect: () => onColor(c.id) })) },
    { separator: true },
    { label: 'Löschen', icon: <Trash2 size={16} />, danger: true, onSelect: onDelete }
  ];
  return (
    <ContextMenu items={menu}>
      <article
        className={clsx('note-card', `note-c-${color}`, active && 'active')}
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOpen();
          else if (e.key === 'Delete') onDelete();
        }}
      >
        <div className="note-card-bar" />
        <h3 className={clsx('note-card-title', !note.title.trim() && !note.body.trim() && 'placeholder')}>{heading}</h3>
        {preview && <p className="note-card-body">{preview}</p>}
        <footer className="note-card-footer">
          <span>{relativeDate(note.updated)}</span>
          <button
            type="button"
            className="note-card-delete"
            title="Löschen"
            aria-label="Notiz löschen"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 size={14} />
          </button>
        </footer>
      </article>
    </ContextMenu>
  );
}
