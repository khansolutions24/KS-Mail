// Dialog for creating / editing a mail rule.

import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Rule, RuleCondition, RuleOp } from '@shared/types';
import { isValidEmail } from '@shared/util';
import { useApp } from '../store/app';
import { Button, Checkbox, Dialog, Field, IconButton, Switch } from '../components/ui';
import { Segmented, Select, type Opt } from './common';
import { ActionsEditor, COND_FIELDS, COND_OPS, changeCondField, isTextField, type CondField } from './ruleParts';

function ConditionRow({ c, onChange, onRemove }: { c: RuleCondition; onChange: (c: RuleCondition) => void; onRemove: () => void }): JSX.Element {
  return (
    <div className="row st-rule-line">
      <Select<CondField> value={c.field} options={COND_FIELDS} onChange={(f) => onChange(changeCondField(c, f))} style={{ width: 190 }} />
      {c.field === 'header' && <input className="input" style={{ width: 150 }} placeholder="Name, z. B. List-Id" value={c.headerName ?? ''} onChange={(e) => onChange({ ...c, headerName: e.target.value })} spellCheck={false} />}
      {isTextField(c.field) && (
        <>
          <Select<RuleOp> value={c.op ?? 'contains'} options={COND_OPS} onChange={(op) => onChange({ ...c, op })} style={{ width: 170 }} />
          <input className="input grow" value={c.value} placeholder={c.op === 'regex' ? 'z. B. ^Rechnung \\d+' : 'Text'} onChange={(e) => onChange({ ...c, value: e.target.value })} spellCheck={false} />
        </>
      )}
      {c.field === 'hasAttachment' && (
        <Select
          value={c.value === 'false' ? 'false' : 'true'}
          options={[
            { value: 'true', label: 'ja' },
            { value: 'false', label: 'nein' }
          ]}
          onChange={(value) => onChange({ ...c, value })}
          className="grow"
        />
      )}
      {c.field === 'sizeGreater' && (
        <span className="row grow">
          <input className="input" type="number" min={1} style={{ width: 120 }} value={c.value} onChange={(e) => onChange({ ...c, value: e.target.value })} />
          <span className="muted">KB</span>
        </span>
      )}
      {c.field === 'importance' && (
        <Select
          value={c.value === 'normal' ? 'normal' : 'high'}
          options={[
            { value: 'high', label: 'hoch' },
            { value: 'normal', label: 'normal' }
          ]}
          onChange={(value) => onChange({ ...c, value })}
          className="grow"
        />
      )}
      <IconButton small label="Bedingung entfernen" onClick={onRemove}>
        <Trash2 size={15} />
      </IconButton>
    </div>
  );
}

function validate(r: Rule): string | null {
  if (!r.name.trim()) return 'Bitte einen Namen für die Regel eingeben.';
  if (!r.actions.length) return 'Bitte mindestens eine Aktion hinzufügen.';
  for (const c of r.conditions) {
    if (isTextField(c.field) && !c.value) return 'Bitte bei allen Bedingungen einen Wert eingeben.';
    if (c.field === 'header' && !c.headerName?.trim()) return 'Bitte den Namen der Kopfzeile angeben.';
    if (c.op === 'regex') {
      try {
        new RegExp(c.value, 'i');
      } catch {
        return `Ungültiger regulärer Ausdruck: ${c.value}`;
      }
    }
    if (c.field === 'sizeGreater' && !(Number(c.value) > 0)) return 'Bitte eine gültige Größe in KB angeben.';
  }
  for (const a of r.actions) {
    if (a.type === 'forward' && !isValidEmail(a.to)) return 'Bitte eine gültige Weiterleitungsadresse angeben.';
    if (a.type === 'category' && !a.category) return 'Bitte eine Kategorie wählen.';
  }
  return null;
}

export function RuleEditor({ rule, onSave, onClose }: { rule: Rule | null; onSave: (r: Rule) => void; onClose: () => void }): JSX.Element {
  const accounts = useApp((s) => s.accounts);
  const [draft, setDraft] = useState<Rule | null>(rule);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(rule);
    setError(null);
  }, [rule]);

  if (!draft) return <></>;
  const set = (patch: Partial<Rule>): void => setDraft({ ...draft, ...patch });
  const accountOptions: Opt<string | null>[] = [{ value: null, label: 'Alle Konten' }, ...accounts.map((a) => ({ value: a.id, label: `${a.name} <${a.email}>` }))];

  const save = (): void => {
    const trimmed = { ...draft, name: draft.name.trim() };
    const err = validate(trimmed);
    if (err) {
      setError(err);
      return;
    }
    onSave(trimmed);
  };

  return (
    <Dialog
      open={!!rule}
      onClose={onClose}
      title={rule && rule.name ? `Regel bearbeiten – ${rule.name}` : 'Neue Regel'}
      width={780}
      footer={
        <>
          <Switch checked={draft.enabled} onChange={(enabled) => set({ enabled })} label="Aktiviert" />
          <span className="grow" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="col st-wizard-form">
        <div className="st-grid-2">
          <Field label="Name">
            <input className="input" value={draft.name} autoFocus onChange={(e) => set({ name: e.target.value })} placeholder="z. B. Newsletter ablegen" />
          </Field>
          <Field label="Gilt für">
            <Select value={draft.accountId} options={accountOptions} onChange={(accountId) => set({ accountId })} />
          </Field>
        </div>

        <div className="st-rule-block">
          <div className="row st-rule-block-head">
            <strong className="grow">Bedingungen</strong>
            <Segmented<Rule['match']>
              value={draft.match}
              onChange={(match) => set({ match })}
              options={[
                { value: 'all', label: 'Alle erfüllt' },
                { value: 'any', label: 'Mindestens eine' }
              ]}
            />
          </div>
          <div className="col st-rows">
            {draft.conditions.length === 0 && <span className="muted small-text">Ohne Bedingung gilt die Regel für jede neue Nachricht.</span>}
            {draft.conditions.map((c, i) => (
              <ConditionRow key={i} c={c} onChange={(nc) => set({ conditions: draft.conditions.map((x, j) => (j === i ? nc : x)) })} onRemove={() => set({ conditions: draft.conditions.filter((_, j) => j !== i) })} />
            ))}
            <div>
              <Button small icon={<Plus size={14} />} onClick={() => set({ conditions: [...draft.conditions, { field: 'from', op: 'contains', value: '' }] })}>
                Bedingung hinzufügen
              </Button>
            </div>
          </div>
        </div>

        <div className="st-rule-block">
          <div className="row st-rule-block-head">
            <strong className="grow">Aktionen</strong>
          </div>
          <ActionsEditor actions={draft.actions} accountId={draft.accountId} onChange={(actions) => set({ actions })} />
        </div>

        <Checkbox checked={draft.stopProcessing} onChange={(stopProcessing) => set({ stopProcessing })} label="Keine weiteren Regeln anwenden" />
        {!draft.accountId && <span className="muted small-text">Bei „Alle Konten“ wird der Ordnerpfad in jedem Konto gesucht. Sonderordner (Archiv, Gelöschte Elemente, Junk) werden je Konto automatisch zugeordnet.</span>}
        {error && <div className="st-error-box">{error}</div>}
      </div>
    </Dialog>
  );
}
