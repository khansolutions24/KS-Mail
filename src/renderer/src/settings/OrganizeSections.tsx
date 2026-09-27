// "Kategorien" and "QuickSteps".

import { Archive, Check, Clock, Flag, Folder, Mail, Pin, Plus, RotateCcw, Star, Tag, Trash2, Zap, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import type { Category, QuickStep } from '@shared/types';
import { DEFAULT_CATEGORIES } from '@shared/defaults';
import { newId } from '@shared/util';
import { confirm, prompt, toast, useApp } from '../store/app';
import { Button, ColorPicker, Empty, IconButton } from '../components/ui';
import { Card, Page, Select, TextInput, update, type SectionProps } from './common';
import { ActionsEditor } from './ruleParts';

const CATEGORY_COLORS = ['#d13438', '#ca5010', '#c19c00', '#107c10', '#0f6cbd', '#8764b8', '#e3008c', '#038387', '#498205', '#004e8c', '#69797e', '#393939'];

function saveCategories(fn: (list: Category[]) => Category[]): void {
  const s = useApp.getState().settings;
  if (s) void update({ categories: fn(s.categories) });
}

export function CategoriesSection({ settings }: SectionProps): JSX.Element {
  const [colorOpen, setColorOpen] = useState<string | null>(null);
  const list = settings.categories;

  const add = async (): Promise<void> => {
    const name = (await prompt('Neue Kategorie', '', 'Name', 'Hinzufügen'))?.trim();
    if (!name) return;
    if (list.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      toast('error', `Die Kategorie „${name}“ existiert bereits.`);
      return;
    }
    const used = new Set(list.map((c) => c.color));
    saveCategories((l) => [...l, { name, color: CATEGORY_COLORS.find((c) => !used.has(c)) ?? CATEGORY_COLORS[0] }]);
  };

  const rename = (c: Category, name: string): void => {
    const n = name.trim();
    if (!n || n === c.name) return;
    if (list.some((x) => x !== c && x.name.toLowerCase() === n.toLowerCase())) {
      toast('error', `Die Kategorie „${n}“ existiert bereits.`);
      return;
    }
    saveCategories((l) => l.map((x) => (x.name === c.name ? { ...x, name: n } : x)));
  };

  const remove = async (c: Category): Promise<void> => {
    if (!(await confirm('Kategorie löschen', `Kategorie „${c.name}“ löschen? Bereits zugewiesene Nachrichten behalten die Bezeichnung, sie wird aber nicht mehr farbig angezeigt.`, 'Löschen', true))) return;
    saveCategories((l) => l.filter((x) => x.name !== c.name));
  };

  const reset = async (): Promise<void> => {
    if (await confirm('Kategorien zurücksetzen', 'Alle Kategorien durch die Standardkategorien ersetzen?', 'Zurücksetzen', true)) void update({ categories: DEFAULT_CATEGORIES });
  };

  return (
    <Page
      title="Kategorien"
      description="Farbige Kategorien für Nachrichten, Termine und Aufgaben. Umbenennen wirkt sich nicht auf bereits kategorisierte Nachrichten aus."
      actions={
        <>
          <Button icon={<RotateCcw size={16} />} onClick={() => void reset()}>
            Standard wiederherstellen
          </Button>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => void add()}>
            Neue Kategorie
          </Button>
        </>
      }
    >
      <Card flush>
        {list.length === 0 ? (
          <Empty icon={<Tag size={32} />} title="Keine Kategorien" />
        ) : (
          <ul className="st-items">
            {list.map((c) => (
              <li key={c.name} className="st-item st-item-wrap">
                <button type="button" className="st-color-btn" style={{ background: c.color }} title="Farbe ändern" onClick={() => setColorOpen(colorOpen === c.name ? null : c.name)} />
                <TextInput value={c.name} onCommit={(n) => rename(c, n)} delay={0} style={{ maxWidth: 280 }} className="grow" />
                <span className="grow" />
                <IconButton label="Löschen" onClick={() => void remove(c)}>
                  <Trash2 size={16} />
                </IconButton>
                {colorOpen === c.name && (
                  <div className="st-item-extra">
                    <ColorPicker
                      value={c.color}
                      colors={CATEGORY_COLORS}
                      onChange={(color) => {
                        saveCategories((l) => l.map((x) => (x.name === c.name ? { ...x, color } : x)));
                        setColorOpen(null);
                      }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
}

// ─── QuickSteps ───

export const QUICKSTEP_ICONS: Record<string, LucideIcon> = { check: Check, clock: Clock, archive: Archive, flag: Flag, folder: Folder, mail: Mail, star: Star, zap: Zap, tag: Tag, pin: Pin, trash: Trash2 };

const ICON_LABELS: Record<string, string> = { check: 'Haken', clock: 'Uhr', archive: 'Archiv', flag: 'Fahne', folder: 'Ordner', mail: 'Brief', star: 'Stern', zap: 'Blitz', tag: 'Etikett', pin: 'Pin', trash: 'Papierkorb' };

function saveQuickSteps(fn: (list: QuickStep[]) => QuickStep[]): void {
  const s = useApp.getState().settings;
  if (s) void update({ quickSteps: fn(s.quickSteps) });
}

function patchStep(id: string, patch: Partial<QuickStep>): void {
  saveQuickSteps((l) => l.map((q) => (q.id === id ? { ...q, ...patch } : q)));
}

export function QuickStepsSection({ settings }: SectionProps): JSX.Element {
  const list = settings.quickSteps;

  const add = (): void => saveQuickSteps((l) => [...l, { id: newId(), name: `QuickStep ${l.length + 1}`, icon: 'zap', actions: [{ type: 'markRead' }] }]);

  const remove = async (q: QuickStep): Promise<void> => {
    if (await confirm('QuickStep löschen', `QuickStep „${q.name}“ löschen?`, 'Löschen', true)) saveQuickSteps((l) => l.filter((x) => x.id !== q.id));
  };

  return (
    <Page
      title="QuickSteps"
      description="Mehrere Aktionen mit einem Klick auf die ausgewählten Nachrichten anwenden (Menüband und Kontextmenü)."
      actions={
        <Button variant="primary" icon={<Plus size={16} />} onClick={add}>
          Neuer QuickStep
        </Button>
      }
    >
      {list.length === 0 && (
        <Card>
          <Empty icon={<Zap size={32} />} title="Keine QuickSteps" />
        </Card>
      )}
      {list.map((q) => {
        const Icon = QUICKSTEP_ICONS[q.icon] ?? Zap;
        return (
          <Card
            key={q.id}
            title={
              <span className="row">
                <Icon size={18} />
                <TextInput value={q.name} onCommit={(name) => patchStep(q.id, { name: name.trim() || 'QuickStep' })} style={{ width: 260 }} />
                <Select value={QUICKSTEP_ICONS[q.icon] ? q.icon : 'zap'} options={Object.keys(QUICKSTEP_ICONS).map((k) => ({ value: k, label: `Symbol: ${ICON_LABELS[k] ?? k}` }))} onChange={(icon) => patchStep(q.id, { icon })} />
              </span>
            }
            actions={
              <IconButton label="QuickStep löschen" onClick={() => void remove(q)}>
                <Trash2 size={16} />
              </IconButton>
            }
          >
            <ActionsEditor actions={q.actions} accountId={null} onChange={(actions) => patchStep(q.id, { actions })} />
          </Card>
        );
      })}
    </Page>
  );
}
