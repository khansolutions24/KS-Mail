// Dialog for creating / editing a contact.

import { Plus, Star, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Contact } from '@shared/types';
import { isValidEmail } from '@shared/util';
import { Button, Dialog, Field, IconButton, Switch } from '../components/ui';
import { toast } from '../store/app';
import { useContacts } from './store';
import { LABELS } from './contactUtils';

type Entry = { label: string; value: string };

function EntryRows({ title, entries, onChange, type, placeholder, defaultLabel, addLabel }: { title: string; entries: Entry[]; onChange: (e: Entry[]) => void; type: string; placeholder: string; defaultLabel: string; addLabel: string }): JSX.Element {
  const set = (i: number, patch: Partial<Entry>): void => onChange(entries.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  return (
    <div className="field">
      <label>{title}</label>
      {entries.map((e, i) => (
        <div key={i} className="row">
          <select className="select contact-label-select" value={LABELS.includes(e.label as (typeof LABELS)[number]) ? e.label : 'Sonstige'} onChange={(ev) => set(i, { label: ev.target.value })}>
            {LABELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <input
            className={`input grow${type === 'email' && e.value.trim() && !isValidEmail(e.value) ? ' invalid' : ''}`}
            type={type}
            value={e.value}
            placeholder={placeholder}
            onChange={(ev) => set(i, { value: ev.target.value })}
          />
          <IconButton label="Entfernen" onClick={() => onChange(entries.filter((_, j) => j !== i))}>
            <X size={16} />
          </IconButton>
        </div>
      ))}
      <div>
        <Button variant="subtle" small icon={<Plus size={14} />} onClick={() => onChange([...entries, { label: defaultLabel, value: '' }])}>
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

export function ContactEditor(): JSX.Element | null {
  const editing = useContacts((s) => s.editing);
  const [c, setC] = useState<Contact | null>(editing);
  const [groups, setGroups] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) return;
    // start new contacts with one empty e-mail and phone row
    setC({
      ...editing,
      emails: editing.emails.length ? editing.emails : [{ label: 'Geschäftlich', value: '' }],
      phones: editing.phones.length ? editing.phones : [{ label: 'Mobil', value: '' }]
    });
    setGroups(editing.groups.join(', '));
  }, [editing]);

  if (!editing || !c) return null;
  const isNew = !useContacts.getState().contacts.some((x) => x.id === editing.id);
  const patch = (p: Partial<Contact>): void => setC({ ...c, ...p });
  const patchAddr = (p: Partial<Contact['address']>): void => setC({ ...c, address: { ...c.address, ...p } });
  const close = (): void => useContacts.getState().edit(null);

  const save = async (): Promise<void> => {
    const emails = c.emails.map((e) => ({ ...e, value: e.value.trim() })).filter((e) => e.value);
    const bad = emails.find((e) => !isValidEmail(e.value));
    if (bad) {
      toast('error', `Ungültige E-Mail-Adresse: ${bad.value}`);
      return;
    }
    const out: Contact = {
      ...c,
      firstName: c.firstName.trim(),
      lastName: c.lastName.trim(),
      displayName: c.displayName.trim(),
      emails,
      phones: c.phones.map((p) => ({ ...p, value: p.value.trim() })).filter((p) => p.value),
      groups: [...new Set(groups.split(',').map((g) => g.trim()).filter(Boolean))],
      // an edited collected address becomes a regular contact
      collected: false
    };
    if (!out.firstName && !out.lastName && !out.displayName && !out.company && !out.emails.length) {
      toast('error', 'Bitte geben Sie mindestens einen Namen, eine Firma oder eine E-Mail-Adresse ein.');
      return;
    }
    setBusy(true);
    const saved = await useContacts.getState().save(out);
    setBusy(false);
    if (saved) {
      useContacts.getState().select([saved.id], saved.id);
      close();
    }
  };

  return (
    <Dialog
      open
      onClose={close}
      title={isNew ? 'Neuer Kontakt' : 'Kontakt bearbeiten'}
      width={640}
      footer={
        <>
          <Switch checked={c.favorite} onChange={(favorite) => patch({ favorite })} label={<span className="row" style={{ gap: 4 }}><Star size={14} /> Favorit</span>} />
          <span className="grow" />
          <Button onClick={close}>Abbrechen</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            Speichern
          </Button>
        </>
      }
    >
      <form
        className="contact-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onKeyDown={(e) => {
          // inputs submit implicitly on Enter; the notes textarea saves with Ctrl/Cmd+Enter
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target instanceof HTMLTextAreaElement) {
            e.preventDefault();
            void save();
          }
        }}
      >
        <div className="contact-form-grid">
          <Field label="Vorname">
            <input className="input" autoFocus value={c.firstName} onChange={(e) => patch({ firstName: e.target.value })} />
          </Field>
          <Field label="Nachname">
            <input className="input" value={c.lastName} onChange={(e) => patch({ lastName: e.target.value })} />
          </Field>
          <Field label="Anzeigename" hint="Leer lassen, um „Vorname Nachname“ zu verwenden" style={{ gridColumn: '1 / -1' }}>
            <input className="input" value={c.displayName} placeholder={[c.firstName, c.lastName].filter(Boolean).join(' ')} onChange={(e) => patch({ displayName: e.target.value })} />
          </Field>
        </div>

        <EntryRows title="E-Mail-Adressen" entries={c.emails} onChange={(emails) => patch({ emails })} type="email" placeholder="name@beispiel.de" defaultLabel="Geschäftlich" addLabel="E-Mail-Adresse hinzufügen" />
        <EntryRows title="Telefonnummern" entries={c.phones} onChange={(phones) => patch({ phones })} type="tel" placeholder="+49 …" defaultLabel="Mobil" addLabel="Telefonnummer hinzufügen" />

        <div className="contact-form-grid">
          <Field label="Firma">
            <input className="input" value={c.company} onChange={(e) => patch({ company: e.target.value })} />
          </Field>
          <Field label="Abteilung">
            <input className="input" value={c.department} onChange={(e) => patch({ department: e.target.value })} />
          </Field>
          <Field label="Position" style={{ gridColumn: '1 / -1' }}>
            <input className="input" value={c.jobTitle} onChange={(e) => patch({ jobTitle: e.target.value })} />
          </Field>
        </div>

        <div className="contact-form-grid">
          <Field label="Straße" style={{ gridColumn: '1 / -1' }}>
            <input className="input" value={c.address.street} onChange={(e) => patchAddr({ street: e.target.value })} />
          </Field>
          <Field label="PLZ">
            <input className="input" value={c.address.zip} onChange={(e) => patchAddr({ zip: e.target.value })} />
          </Field>
          <Field label="Ort">
            <input className="input" value={c.address.city} onChange={(e) => patchAddr({ city: e.target.value })} />
          </Field>
          <Field label="Land" style={{ gridColumn: '1 / -1' }}>
            <input className="input" value={c.address.country} onChange={(e) => patchAddr({ country: e.target.value })} />
          </Field>
        </div>

        <div className="contact-form-grid">
          <Field label="Website">
            <input className="input" value={c.website} placeholder="www.beispiel.de" onChange={(e) => patch({ website: e.target.value })} />
          </Field>
          <Field label="Geburtstag">
            <input className="input" type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(c.birthday) ? c.birthday : ''} onChange={(e) => patch({ birthday: e.target.value })} />
          </Field>
          <Field label="Gruppen" hint="Mehrere Gruppen durch Komma trennen" style={{ gridColumn: '1 / -1' }}>
            <input className="input" value={groups} placeholder="z. B. Kunden, Team" onChange={(e) => setGroups(e.target.value)} />
          </Field>
        </div>

        <Field label="Notizen">
          <textarea className="textarea" rows={4} value={c.notes} onChange={(e) => patch({ notes: e.target.value })} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
