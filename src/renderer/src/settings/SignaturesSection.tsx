// "Signaturen" and "Vorlagen": list + rich-text editor (master/detail).

import clsx from 'clsx';
import { FileText, PenLine, Plus, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { MailTemplate, Signature } from '@shared/types';
import { newId } from '@shared/util';
import { confirm, useApp } from '../store/app';
import { Button, Empty, Field } from '../components/ui';
import { Card, Page, TextInput, patchGroup, update, type SectionProps } from './common';
import { RichEditor } from './RichEditor';

// Mutations always start from the latest store state: editors flush on unmount, possibly after a re-render.
function patchSignature(id: string, patch: Partial<Signature>): void {
  const s = useApp.getState().settings;
  if (s) void update({ signatures: s.signatures.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
}

function patchTemplate(id: string, patch: Partial<MailTemplate>): void {
  const s = useApp.getState().settings;
  if (s) void update({ templates: s.templates.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
}

function ListPane<T extends { id: string; name: string }>({ items, selected, onSelect, badge, icon }: { items: T[]; selected: string | null; onSelect: (id: string) => void; badge?: (t: T) => string | null; icon: JSX.Element }): JSX.Element {
  return (
    <ul className="st-master">
      {items.map((t) => (
        <li key={t.id} className={clsx('st-master-item', t.id === selected && 'active')} onClick={() => onSelect(t.id)}>
          {icon}
          <span className="grow ellipsis">{t.name || '(Ohne Namen)'}</span>
          {badge?.(t) && <span className="chip st-chip-accent">{badge(t)}</span>}
        </li>
      ))}
    </ul>
  );
}

export function SignaturesSection({ settings }: SectionProps): JSX.Element {
  const list = settings.signatures;
  const [sel, setSel] = useState<string | null>(list[0]?.id ?? null);
  const current = list.find((s) => s.id === sel) ?? list[0] ?? null;
  const defaultId = settings.mail.defaultSignatureId;
  const accounts = useApp((s) => s.accounts);

  const add = (): void => {
    const sig: Signature = { id: newId(), name: `Signatur ${list.length + 1}`, html: '<p>Mit freundlichen Grüßen<br>' + (accounts[0]?.displayName || '') + '</p>' };
    // the first signature becomes the default automatically
    void update({ signatures: [...list, sig], ...(defaultId ? {} : { mail: { ...settings.mail, defaultSignatureId: sig.id } }) });
    setSel(sig.id);
  };

  const remove = async (sig: Signature): Promise<void> => {
    const used = accounts.filter((a) => a.signatureId === sig.id).length;
    const ok = await confirm('Signatur löschen', `Signatur „${sig.name}“ löschen?${used ? ` Sie ist ${used} Konto/Konten zugewiesen; dort wird dann die Standardsignatur verwendet.` : ''}`, 'Löschen', true);
    if (!ok) return;
    const s = useApp.getState().settings;
    if (!s) return;
    const rest = s.signatures.filter((x) => x.id !== sig.id);
    await update({ signatures: rest, mail: { ...s.mail, defaultSignatureId: s.mail.defaultSignatureId === sig.id ? null : s.mail.defaultSignatureId } });
    setSel(rest[0]?.id ?? null);
  };

  return (
    <Page
      title="Signaturen"
      description="Signaturen werden beim Verfassen automatisch eingefügt. Pro Konto kann eine eigene Signatur gewählt werden (Konten → Bearbeiten)."
      actions={
        <Button variant="primary" icon={<Plus size={16} />} onClick={add}>
          Neue Signatur
        </Button>
      }
    >
      <Card flush>
        {!current ? (
          <Empty icon={<PenLine size={32} />} title="Keine Signaturen">
            <p>Erstellen Sie eine Signatur mit Name, Kontaktdaten oder Logo-Link.</p>
            <Button icon={<Plus size={16} />} onClick={add}>
              Neue Signatur
            </Button>
          </Empty>
        ) : (
          <div className="st-split">
            <ListPane items={list} selected={current.id} onSelect={setSel} icon={<PenLine size={15} />} badge={(s) => (s.id === defaultId ? 'Standard' : null)} />
            <div className="st-detail col" key={current.id}>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <Field label="Name" style={{ flex: 1 }}>
                  <TextInput value={current.name} onCommit={(name) => patchSignature(current.id, { name: name.trim() || 'Signatur' })} />
                </Field>
                <Button icon={<Star size={16} />} disabled={current.id === defaultId} onClick={() => void patchGroup('mail', { defaultSignatureId: current.id })}>
                  {current.id === defaultId ? 'Standardsignatur' : 'Als Standard festlegen'}
                </Button>
                <Button icon={<Trash2 size={16} />} onClick={() => void remove(current)}>
                  Löschen
                </Button>
              </div>
              <RichEditor key={current.id} value={current.html} onChange={(html) => patchSignature(current.id, { html })} placeholder="Signatur eingeben …" />
            </div>
          </div>
        )}
      </Card>
    </Page>
  );
}

export function TemplatesSection({ settings }: SectionProps): JSX.Element {
  const list = settings.templates;
  const [sel, setSel] = useState<string | null>(list[0]?.id ?? null);
  const current = list.find((t) => t.id === sel) ?? list[0] ?? null;

  const add = (): void => {
    const t: MailTemplate = { id: newId(), name: `Vorlage ${list.length + 1}`, subject: '', html: '' };
    void update({ templates: [...list, t] });
    setSel(t.id);
  };

  const remove = async (t: MailTemplate): Promise<void> => {
    if (!(await confirm('Vorlage löschen', `Vorlage „${t.name}“ löschen?`, 'Löschen', true))) return;
    const s = useApp.getState().settings;
    if (!s) return;
    const rest = s.templates.filter((x) => x.id !== t.id);
    await update({ templates: rest });
    setSel(rest[0]?.id ?? null);
  };

  return (
    <Page
      title="Vorlagen"
      description="Vorlagen können beim Verfassen einer Nachricht eingefügt werden (Betreff und Text)."
      actions={
        <Button variant="primary" icon={<Plus size={16} />} onClick={add}>
          Neue Vorlage
        </Button>
      }
    >
      <Card flush>
        {!current ? (
          <Empty icon={<FileText size={32} />} title="Keine Vorlagen">
            <p>Speichern Sie häufig verwendete Antworten als Vorlage.</p>
            <Button icon={<Plus size={16} />} onClick={add}>
              Neue Vorlage
            </Button>
          </Empty>
        ) : (
          <div className="st-split">
            <ListPane items={list} selected={current.id} onSelect={setSel} icon={<FileText size={15} />} />
            <div className="st-detail col" key={current.id}>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <Field label="Name" style={{ flex: 1 }}>
                  <TextInput value={current.name} onCommit={(name) => patchTemplate(current.id, { name: name.trim() || 'Vorlage' })} />
                </Field>
                <Button icon={<Trash2 size={16} />} onClick={() => void remove(current)}>
                  Löschen
                </Button>
              </div>
              <Field label="Betreff" hint="Leer lassen, um den Betreff beim Einfügen nicht zu ändern">
                <TextInput value={current.subject} onCommit={(subject) => patchTemplate(current.id, { subject })} />
              </Field>
              <RichEditor key={current.id} value={current.html} onChange={(html) => patchTemplate(current.id, { html })} minHeight={240} placeholder="Text der Vorlage …" />
            </div>
          </div>
        )}
      </Card>
    </Page>
  );
}
