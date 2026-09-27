// "Tastenkombinationen": all commands grouped, with key capture, per-row reset and conflict warnings.

import clsx from 'clsx';
import { AlertTriangle, Keyboard, RotateCcw, Search } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { COMMANDS, COMMAND_BY_ID } from '@shared/commands';
import type { Shortcut } from '@shared/types';
import { isMac } from '../api/client';
import { confirm, useApp } from '../store/app';
import { comboFromEvent, formatKeys } from '../lib/keys';
import { Button, Empty } from '../components/ui';
import { Card, Page, update, type SectionProps } from './common';

/** Stores `keys` for a command; overrides equal to the default are dropped ('' = disabled) */
function setKeys(command: string, keys: string | null): void {
  const s = useApp.getState().settings;
  if (!s) return;
  const others = s.shortcuts.filter((x) => x.command !== command);
  const def = COMMAND_BY_ID.get(command)?.keys ?? '';
  const next: Shortcut[] = keys === null || keys === def ? others : [...others, { command, keys }];
  void update({ shortcuts: next });
}

/** Effective bindings computed from the given overrides (same rules as lib/commands `bindings()`) */
function effective(overrides: Shortcut[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of COMMANDS) if (c.keys) map.set(c.id, c.keys);
  for (const o of overrides) {
    if (o.keys) map.set(o.command, o.keys);
    else map.delete(o.command);
  }
  return map;
}

function Keys({ keys }: { keys: string }): JSX.Element {
  // "Mod+Shift+R" → separate key caps
  return (
    <span className="st-keys">
      {keys.split(/\+(?!$)/).map((k, i) => (
        <kbd key={i} className="kbd">
          {formatKeys(k)}
        </kbd>
      ))}
    </span>
  );
}

export function ShortcutsSection({ settings }: SectionProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [capturing, setCapturing] = useState<string | null>(null);
  const overrides = settings.shortcuts;
  const map = useMemo(() => effective(overrides), [overrides]);
  const overridden = useMemo(() => new Set(overrides.map((o) => o.command)), [overrides]);

  // conflicts: same keys used by several commands of the same group
  const conflicts = useMemo(() => {
    const byKey = new Map<string, string[]>();
    for (const c of COMMANDS) {
      const k = map.get(c.id);
      if (!k) continue;
      const id = `${c.group}|${k.toLowerCase()}`;
      byKey.set(id, [...(byKey.get(id) ?? []), c.id]);
    }
    const out = new Map<string, string[]>();
    for (const ids of byKey.values()) if (ids.length > 1) for (const id of ids) out.set(id, ids.filter((x) => x !== id));
    return out;
  }, [map]);

  // key capture: records the next combination; Escape cancels, Backspace alone removes the binding
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
      if (plain && e.key === 'Escape') {
        setCapturing(null);
        return;
      }
      if (plain && e.key === 'Backspace') {
        setKeys(capturing, '');
        setCapturing(null);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return; // only a modifier so far
      setKeys(capturing, combo);
      setCapturing(null);
    };
    const cancel = (): void => setCapturing(null);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', cancel);
    };
  }, [capturing]);

  const q = query.trim().toLowerCase();
  const visible = COMMANDS.filter((c) => !q || c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q) || formatKeys(map.get(c.id)).toLowerCase().includes(q) || (map.get(c.id) ?? '').toLowerCase().includes(q));
  const groups = [...new Set(visible.map((c) => c.group))];

  const resetAll = async (): Promise<void> => {
    if (await confirm('Alle Tastenkombinationen zurücksetzen', 'Alle eigenen Tastenkombinationen entfernen und die Standardbelegung wiederherstellen?', 'Zurücksetzen', true)) void update({ shortcuts: [] });
  };

  return (
    <Page
      title="Tastenkombinationen"
      description={
        <>
          Klicken Sie auf „Ändern“ und drücken Sie die neue Tastenkombination. <kbd className="kbd">Esc</kbd> bricht ab, <kbd className="kbd">{formatKeys('Backspace')}</kbd> entfernt die Belegung.
          {isMac ? ' „⌘“ entspricht unter Windows der Strg-Taste.' : ' Unter macOS wird Strg automatisch zu ⌘.'}
        </>
      }
      actions={
        <Button icon={<RotateCcw size={16} />} disabled={overrides.length === 0} onClick={() => void resetAll()}>
          Alle zurücksetzen
        </Button>
      }
    >
      <div className="st-search">
        <Search size={16} />
        <input className="input grow" placeholder="Befehl oder Taste suchen …" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {conflicts.size > 0 && !q && (
        <div className="st-warning">
          <AlertTriangle size={16} /> {conflicts.size} Befehle teilen sich eine Tastenkombination. Betroffene Zeilen sind markiert.
        </div>
      )}
      {groups.length === 0 && (
        <Card>
          <Empty icon={<Keyboard size={32} />} title="Keine Befehle gefunden" />
        </Card>
      )}
      {groups.map((g) => (
        <Card key={g} title={g} flush>
          <table className="st-table">
            <tbody>
              {visible
                .filter((c) => c.group === g)
                .map((c) => {
                  const keys = map.get(c.id) ?? '';
                  const conflict = conflicts.get(c.id);
                  const isCapturing = capturing === c.id;
                  return (
                    <Fragment key={c.id}>
                      <tr className={clsx(isCapturing && 'capturing', conflict && 'conflict')}>
                        <td className="st-sc-label">
                          {c.label}
                          {overridden.has(c.id) && <span className="chip st-chip-accent">Angepasst</span>}
                        </td>
                        <td className="st-sc-keys">
                          {isCapturing ? <span className="st-capture">Tastenkombination drücken …</span> : keys ? <Keys keys={keys} /> : <span className="muted">—</span>}
                        </td>
                        <td className="st-sc-actions">
                          <Button small variant={isCapturing ? 'primary' : undefined} onClick={() => setCapturing(isCapturing ? null : c.id)}>
                            {isCapturing ? 'Abbrechen' : 'Ändern'}
                          </Button>
                          <Button small variant="subtle" disabled={!overridden.has(c.id)} onClick={() => setKeys(c.id, null)} title={c.keys ? `Standard: ${formatKeys(c.keys)}` : 'Standard: keine'}>
                            Zurücksetzen
                          </Button>
                        </td>
                      </tr>
                      {conflict && (
                        <tr className="st-conflict-row">
                          <td colSpan={3}>
                            <AlertTriangle size={13} /> Gleiche Tasten wie: {conflict.map((id) => COMMAND_BY_ID.get(id)?.label ?? id).join(', ')}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
            </tbody>
          </table>
        </Card>
      ))}
    </Page>
  );
}
