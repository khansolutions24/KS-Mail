// "Regeln": ordered rule list with enable switch, editor dialog and "Jetzt ausführen".

import clsx from 'clsx';
import { ArrowDown, ArrowUp, Copy, ListFilter, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Rule } from '@shared/types';
import { newId } from '@shared/util';
import { api } from '../api/client';
import { attempt, confirm, toast, useApp } from '../store/app';
import { Button, Empty, IconButton, Spinner, Switch } from '../components/ui';
import { Card, Page, moveItem, type SectionProps } from './common';
import { FolderIdSelect, describeRule } from './ruleParts';
import { RuleEditor } from './RuleEditor';

/** Saves the rule list (optimistically updates the store; the backend echoes settings:changed) */
async function saveRules(rules: Rule[]): Promise<void> {
  const s = useApp.getState().settings;
  if (s) useApp.setState({ settings: { ...s, rules } });
  const ok = await attempt(() => api.settings.saveRules(rules).then(() => true));
  if (!ok && s) useApp.setState({ settings: s });
}

function newRule(): Rule {
  return { id: newId(), name: '', enabled: true, accountId: null, match: 'all', conditions: [{ field: 'from', op: 'contains', value: '' }], actions: [{ type: 'move', folderPath: '@archive' }], stopProcessing: false };
}

export function RulesSection({ settings }: SectionProps): JSX.Element {
  const rules = settings.rules;
  const accounts = useApp((s) => s.accounts);
  const folders = useApp((s) => s.folders);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [runFolder, setRunFolder] = useState('');
  const [running, setRunning] = useState(false);

  // default target for "run now": first inbox
  useEffect(() => {
    if (!runFolder || !folders.some((f) => f.id === runFolder)) setRunFolder(folders.find((f) => f.specialUse === 'inbox')?.id ?? folders[0]?.id ?? '');
  }, [folders, runFolder]);

  const latest = (): Rule[] => useApp.getState().settings?.rules ?? rules;

  const save = (r: Rule): void => {
    const list = latest();
    void saveRules(list.some((x) => x.id === r.id) ? list.map((x) => (x.id === r.id ? r : x)) : [...list, r]);
    setEditing(null);
  };

  const remove = async (r: Rule): Promise<void> => {
    if (!(await confirm('Regel löschen', `Regel „${r.name}“ löschen?`, 'Löschen', true))) return;
    void saveRules(latest().filter((x) => x.id !== r.id));
  };

  const run = async (): Promise<void> => {
    if (!runFolder) return;
    setRunning(true);
    const n = await attempt(() => api.settings.runRules(runFolder));
    setRunning(false);
    if (n !== undefined) toast('success', n === 1 ? 'Regeln auf 1 Nachricht angewendet' : `Regeln auf ${n} Nachrichten angewendet`);
  };

  const accountName = (id: string | null): string => (id ? (accounts.find((a) => a.id === id)?.name ?? 'Unbekanntes Konto') : 'Alle Konten');

  return (
    <Page
      title="Regeln"
      description="Regeln werden in der angezeigten Reihenfolge auf neu eingehende Nachrichten angewendet."
      actions={
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing(newRule())}>
          Neue Regel
        </Button>
      }
    >
      <Card flush>
        {rules.length === 0 ? (
          <Empty icon={<ListFilter size={32} />} title="Keine Regeln">
            <p>Mit Regeln verschieben, markieren oder kategorisieren Sie Nachrichten automatisch.</p>
            <Button icon={<Plus size={16} />} onClick={() => setEditing(newRule())}>
              Neue Regel
            </Button>
          </Empty>
        ) : (
          <ul className="st-items">
            {rules.map((r, i) => (
              <li key={r.id} className={clsx('st-item', !r.enabled && 'disabled')} onDoubleClick={() => setEditing(r)}>
                <span title={r.enabled ? 'Regel deaktivieren' : 'Regel aktivieren'}>
                  <Switch checked={r.enabled} onChange={(enabled) => void saveRules(latest().map((x) => (x.id === r.id ? { ...x, enabled } : x)))} />
                </span>
                <div className="grow st-item-main">
                  <div className="row st-item-title">
                    <strong className="ellipsis">{r.name || '(Ohne Namen)'}</strong>
                    <span className="chip">{accountName(r.accountId)}</span>
                  </div>
                  <div className="muted small-text st-clamp">{describeRule(r)}</div>
                </div>
                <div className="row st-item-actions">
                  <IconButton small label="Nach oben" disabled={i === 0} onClick={() => void saveRules(moveItem(latest(), i, -1))}>
                    <ArrowUp size={16} />
                  </IconButton>
                  <IconButton small label="Nach unten" disabled={i === rules.length - 1} onClick={() => void saveRules(moveItem(latest(), i, 1))}>
                    <ArrowDown size={16} />
                  </IconButton>
                  <IconButton label="Bearbeiten" onClick={() => setEditing(r)}>
                    <Pencil size={16} />
                  </IconButton>
                  <IconButton label="Duplizieren" onClick={() => setEditing({ ...r, id: newId(), name: `${r.name} (Kopie)` })}>
                    <Copy size={16} />
                  </IconButton>
                  <IconButton label="Löschen" onClick={() => void remove(r)}>
                    <Trash2 size={16} />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Regeln jetzt ausführen" description="Wendet alle aktivierten Regeln auf die vorhandenen Nachrichten eines Ordners an.">
        {folders.length === 0 ? (
          <span className="muted">Keine Ordner vorhanden – bitte zuerst ein Konto hinzufügen.</span>
        ) : (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <FolderIdSelect value={runFolder} onChange={setRunFolder} />
            <Button icon={running ? <Spinner /> : <Play size={16} />} disabled={running || !runFolder || !rules.some((r) => r.enabled)} onClick={() => void run()}>
              Jetzt ausführen
            </Button>
          </div>
        )}
      </Card>

      <RuleEditor rule={editing} onSave={save} onClose={() => setEditing(null)} />
    </Page>
  );
}
