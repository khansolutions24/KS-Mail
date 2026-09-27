// Building blocks for rules and QuickSteps: action row editor, folder selects and human-readable summaries.

import { Plus, Trash2 } from 'lucide-react';
import type { Category, Folder, Rule, RuleAction, RuleCondition, RuleOp } from '@shared/types';
import { useApp } from '../store/app';
import { folderLabel, folderTree, type FolderNode } from '../mail/folders';
import { Button, IconButton } from '../components/ui';
import { Select, TextInput, type Opt } from './common';

export type ActionType = RuleAction['type'];

export const ACTION_TYPES: Opt<ActionType>[] = [
  { value: 'move', label: 'Verschieben in Ordner' },
  { value: 'copy', label: 'Kopieren in Ordner' },
  { value: 'markRead', label: 'Als gelesen markieren' },
  { value: 'flag', label: 'Kennzeichnen' },
  { value: 'pin', label: 'Anheften' },
  { value: 'delete', label: 'Löschen' },
  { value: 'category', label: 'Kategorie zuweisen' },
  { value: 'forward', label: 'Weiterleiten an' },
  { value: 'notify', label: 'Benachrichtigung anzeigen' }
];

/** Special folder tokens resolved per account by the backend */
export const SPECIAL_FOLDERS: Opt<string>[] = [
  { value: '@archive', label: 'Archiv' },
  { value: '@trash', label: 'Gelöschte Elemente' },
  { value: '@junk', label: 'Junk-E-Mail' }
];

export function makeAction(type: ActionType, categories: Category[]): RuleAction {
  switch (type) {
    case 'move':
    case 'copy':
      return { type, folderPath: '@archive' };
    case 'category':
      return { type, category: categories[0]?.name ?? '' };
    case 'forward':
      return { type, to: '' };
    case 'notify':
      return { type, text: '' };
    case 'markRead':
      return { type: 'markRead' };
    case 'flag':
      return { type: 'flag' };
    case 'pin':
      return { type: 'pin' };
    case 'delete':
      return { type: 'delete' };
  }
}

function flatten(nodes: FolderNode[], depth = 0, out: { folder: Folder; depth: number }[] = []): { folder: Folder; depth: number }[] {
  for (const n of nodes) {
    out.push({ folder: n.folder, depth });
    flatten(n.children, depth + 1, out);
  }
  return out;
}

/**
 * Folder chooser for move/copy actions. For one account it lists that account's folders; for "all accounts"
 * it lists the distinct folder paths (the path is resolved in every account).
 */
export function FolderPathSelect({ accountId, value, onChange }: { accountId: string | null; value: string; onChange: (path: string) => void }): JSX.Element {
  const folders = useApp((s) => s.folders);
  let options: { value: string; label: string }[];
  if (accountId) {
    options = flatten(folderTree(folders.filter((f) => f.accountId === accountId)))
      .filter((x) => x.folder.selectable)
      .map(({ folder, depth }) => {
        const name = folderLabel(folder);
        // localized special folders additionally show their real server name
        return { value: folder.path, label: `${'\u00a0\u00a0'.repeat(depth)}${name}${name !== folder.name ? ` (${folder.name})` : ''}` };
      });
  } else {
    const paths = [...new Set(folders.filter((f) => f.selectable && f.specialUse !== 'inbox').map((f) => f.path))].sort((a, b) => a.localeCompare(b, 'de'));
    options = paths.map((p) => ({ value: p, label: p }));
  }
  const known = SPECIAL_FOLDERS.some((o) => o.value === value) || options.some((o) => o.value === value);
  return (
    <select className="select st-folder-select" value={value} onChange={(e) => onChange(e.target.value)}>
      <optgroup label="Sonderordner (je Konto)">
        {SPECIAL_FOLDERS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </optgroup>
      {!known && value && (
        <optgroup label="Aktuell">
          <option value={value}>{value}</option>
        </optgroup>
      )}
      <optgroup label={accountId ? 'Ordner' : 'Ordnerpfad (in jedem Konto)'}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

/** Folder chooser returning a folder id, grouped by account (used for "Regeln jetzt ausführen") */
export function FolderIdSelect({ value, onChange }: { value: string; onChange: (id: string) => void }): JSX.Element {
  const folders = useApp((s) => s.folders);
  const accounts = useApp((s) => s.accounts);
  return (
    <select className="select st-folder-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {accounts.map((a) => (
        <optgroup key={a.id} label={a.name}>
          {flatten(folderTree(folders.filter((f) => f.accountId === a.id)))
            .filter((x) => x.folder.selectable)
            .map(({ folder, depth }) => (
              <option key={folder.id} value={folder.id}>
                {'  '.repeat(depth)}
                {folderLabel(folder)}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Editable list of actions (shared by the rule editor and QuickSteps) */
export function ActionsEditor({ actions, onChange, accountId }: { actions: RuleAction[]; onChange: (a: RuleAction[]) => void; accountId: string | null }): JSX.Element {
  const categories = useApp((s) => s.settings?.categories ?? []);
  const set = (i: number, a: RuleAction): void => onChange(actions.map((x, j) => (j === i ? a : x)));
  return (
    <div className="col st-rows">
      {actions.length === 0 && <span className="muted small-text">Noch keine Aktion.</span>}
      {actions.map((a, i) => (
        <div key={i} className="row st-rule-line">
          <Select<ActionType> value={a.type} options={ACTION_TYPES} onChange={(t) => set(i, makeAction(t, categories))} style={{ width: 220 }} />
          <div className="grow row">
            {(a.type === 'move' || a.type === 'copy') && <FolderPathSelect accountId={accountId} value={a.folderPath} onChange={(folderPath) => set(i, { ...a, folderPath })} />}
            {a.type === 'category' && (
              <Select
                value={a.category}
                options={[...(categories.some((c) => c.name === a.category) || !a.category ? [] : [{ value: a.category, label: a.category }]), ...categories.map((c) => ({ value: c.name, label: c.name }))]}
                onChange={(category) => set(i, { ...a, category })}
                className="grow"
              />
            )}
            {a.type === 'forward' && <TextInput className="grow" type="email" value={a.to} placeholder="empfaenger@example.com" delay={300} onCommit={(to) => set(i, { ...a, to: to.trim() })} />}
            {a.type === 'notify' && <TextInput className="grow" value={a.text} placeholder="Text der Benachrichtigung (leer = Betreff)" delay={300} onCommit={(text) => set(i, { ...a, text })} />}
          </div>
          <IconButton small label="Aktion entfernen" onClick={() => onChange(actions.filter((_, j) => j !== i))}>
            <Trash2 size={15} />
          </IconButton>
        </div>
      ))}
      <div>
        <Button small icon={<Plus size={14} />} onClick={() => onChange([...actions, makeAction(actions.some((a) => a.type === 'move') ? 'markRead' : 'move', categories)])}>
          Aktion hinzufügen
        </Button>
      </div>
    </div>
  );
}

// ─── conditions ───

export type CondField = RuleCondition['field'];

export const COND_FIELDS: Opt<CondField>[] = [
  { value: 'from', label: 'Von' },
  { value: 'to', label: 'An' },
  { value: 'cc', label: 'Cc' },
  { value: 'anyRecipient', label: 'An oder Cc' },
  { value: 'subject', label: 'Betreff' },
  { value: 'body', label: 'Text' },
  { value: 'header', label: 'Kopfzeile' },
  { value: 'hasAttachment', label: 'Hat Anhang' },
  { value: 'sizeGreater', label: 'Größe größer als (KB)' },
  { value: 'importance', label: 'Wichtigkeit' }
];

export const COND_OPS: Opt<RuleOp>[] = [
  { value: 'contains', label: 'enthält' },
  { value: 'notContains', label: 'enthält nicht' },
  { value: 'equals', label: 'ist gleich' },
  { value: 'startsWith', label: 'beginnt mit' },
  { value: 'endsWith', label: 'endet mit' },
  { value: 'regex', label: 'Regulärer Ausdruck' }
];

export function isTextField(f: CondField): boolean {
  return f !== 'hasAttachment' && f !== 'sizeGreater' && f !== 'importance';
}

export function changeCondField(c: RuleCondition, field: CondField): RuleCondition {
  if (isTextField(field)) return { field, op: c.op ?? 'contains', value: isTextField(c.field) ? c.value : '', headerName: field === 'header' ? (c.headerName ?? '') : undefined };
  if (field === 'hasAttachment') return { field, value: 'true' };
  if (field === 'sizeGreater') return { field, value: '1024' };
  return { field, value: 'high' };
}

// ─── summaries ───

const label = <T,>(opts: Opt<T>[], v: T): string => opts.find((o) => o.value === v)?.label ?? String(v);

function folderText(path: string): string {
  return SPECIAL_FOLDERS.find((o) => o.value === path)?.label ?? path;
}

export function describeCondition(c: RuleCondition): string {
  if (c.field === 'hasAttachment') return c.value === 'false' ? 'hat keinen Anhang' : 'hat Anhang';
  if (c.field === 'sizeGreater') return `größer als ${c.value} KB`;
  if (c.field === 'importance') return `Wichtigkeit ${c.value === 'high' ? 'hoch' : 'normal'}`;
  const f = c.field === 'header' ? `Kopfzeile „${c.headerName ?? ''}“` : label(COND_FIELDS, c.field);
  return `${f} ${label(COND_OPS, c.op ?? 'contains')} „${c.value}“`;
}

export function describeAction(a: RuleAction): string {
  switch (a.type) {
    case 'move':
      return `verschieben nach ${folderText(a.folderPath)}`;
    case 'copy':
      return `kopieren nach ${folderText(a.folderPath)}`;
    case 'category':
      return `Kategorie „${a.category}“`;
    case 'forward':
      return `weiterleiten an ${a.to || '?'}`;
    case 'notify':
      return 'Benachrichtigung';
    default:
      return label(ACTION_TYPES, a.type).toLowerCase();
  }
}

export function describeRule(r: Rule): string {
  const cond = r.conditions.length ? r.conditions.map(describeCondition).join(r.match === 'all' ? ' und ' : ' oder ') : 'jede Nachricht';
  const act = r.actions.length ? r.actions.map(describeAction).join(', ') : 'keine Aktion';
  return `Wenn ${cond} → ${act}${r.stopProcessing ? ' · danach keine weiteren Regeln' : ''}`;
}
