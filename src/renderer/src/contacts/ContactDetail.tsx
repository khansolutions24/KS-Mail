// Right pane: contact card (single selection) or bulk actions (multi selection).

import { Building2, Cake, Globe, Mail, MapPin, NotebookText, Pencil, Phone, Star, Tag, Trash2, UserRound, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Contact } from '@shared/types';
import { contactName } from '@shared/vcard';
import { api } from '../api/client';
import { attempt } from '../store/app';
import { Avatar, Button, Empty } from '../components/ui';
import { useContacts } from './store';
import { formatBirthday, primaryEmail, websiteUrl } from './contactUtils';
import { callNumber, exportVcf, sendMail } from './actions';
import { RecentMails } from './RecentMails';

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="contact-section">
      <div className="contact-section-title">
        {icon}
        {title}
      </div>
      <div className="contact-section-body">{children}</div>
    </section>
  );
}

function Actions({ contact }: { contact: Contact }): JSX.Element {
  const st = useContacts.getState();
  return (
    <div className="contact-actions">
      <Button variant="primary" icon={<Mail size={16} />} onClick={() => sendMail([contact])} disabled={!primaryEmail(contact)}>
        E-Mail senden
      </Button>
      <Button icon={<Pencil size={16} />} onClick={() => st.edit(contact)}>
        Bearbeiten
      </Button>
      <Button icon={<Star size={16} fill={contact.favorite ? 'currentColor' : 'none'} />} className={contact.favorite ? 'contact-fav-on' : undefined} onClick={() => void st.toggleFavorite([contact.id])}>
        {contact.favorite ? 'Favorit' : 'Zu Favoriten'}
      </Button>
      <Button variant="subtle" icon={<Trash2 size={16} />} onClick={() => void st.remove([contact.id])}>
        Löschen
      </Button>
    </div>
  );
}

function ContactCard({ contact: c }: { contact: Contact }): JSX.Element {
  const name = contactName(c);
  const job = [c.jobTitle, c.department].filter(Boolean).join(' · ');
  const addr = c.address;
  const hasAddress = !!(addr.street || addr.zip || addr.city || addr.country);
  const emails = c.emails.filter((e) => e.value.trim());
  const phones = c.phones.filter((p) => p.value.trim());
  return (
    <div className="contact-card selectable">
      <header className="contact-hero">
        <Avatar name={name} email={primaryEmail(c)} size={88} />
        <div className="grow">
          <h1 className="contact-name">{name}</h1>
          {job && <div className="contact-job">{job}</div>}
          {c.company && (
            <div className="contact-company">
              <Building2 size={14} />
              {c.company}
            </div>
          )}
          {c.collected && <span className="chip">Gesammelte Adresse</span>}
        </div>
      </header>
      <Actions contact={c} />

      <div className="contact-sections">
        {emails.length > 0 && (
          <Section icon={<Mail size={16} />} title="E-Mail-Adressen">
            {emails.map((e, i) => (
              <div key={i} className="contact-kv">
                <span className="contact-k">{e.label || 'E-Mail'}</span>
                <button type="button" className="link-btn" onClick={() => sendMail([c], e.value.trim())} title="Neue E-Mail an diese Adresse">
                  {e.value}
                </button>
              </div>
            ))}
          </Section>
        )}
        {phones.length > 0 && (
          <Section icon={<Phone size={16} />} title="Telefonnummern">
            {phones.map((p, i) => (
              <div key={i} className="contact-kv">
                <span className="contact-k">{p.label || 'Telefon'}</span>
                <button type="button" className="link-btn" onClick={() => callNumber(p.value)} title="Anrufen">
                  {p.value}
                </button>
              </div>
            ))}
          </Section>
        )}
        {hasAddress && (
          <Section icon={<MapPin size={16} />} title="Adresse">
            <div>{addr.street}</div>
            <div>{[addr.zip, addr.city].filter(Boolean).join(' ')}</div>
            <div>{addr.country}</div>
            <button
              type="button"
              className="link-btn small-text"
              onClick={() => void attempt(() => api.app.openExternal(`https://www.openstreetmap.org/search?query=${encodeURIComponent([addr.street, addr.zip, addr.city, addr.country].filter(Boolean).join(', '))}`))}
            >
              Auf Karte anzeigen
            </button>
          </Section>
        )}
        {c.birthday && (
          <Section icon={<Cake size={16} />} title="Geburtstag">
            {formatBirthday(c.birthday)}
          </Section>
        )}
        {c.website && (
          <Section icon={<Globe size={16} />} title="Website">
            <button type="button" className="link-btn" onClick={() => void attempt(() => api.app.openExternal(websiteUrl(c.website)))}>
              {c.website}
            </button>
          </Section>
        )}
        {c.groups.length > 0 && (
          <Section icon={<Tag size={16} />} title="Gruppen">
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {c.groups.map((g) => (
                <button key={g} type="button" className="chip contact-group-chip" onClick={() => useContacts.getState().setFilter({ kind: 'group', name: g })}>
                  {g}
                </button>
              ))}
            </div>
          </Section>
        )}
        {c.notes && (
          <Section icon={<NotebookText size={16} />} title="Notizen">
            <div className="contact-notes">{c.notes}</div>
          </Section>
        )}
        {emails.length > 0 && (
          <Section icon={<Mail size={16} />} title="Letzte E-Mails">
            <RecentMails emails={emails.map((e) => e.value.trim())} />
          </Section>
        )}
      </div>
    </div>
  );
}

function MultiSelection({ contacts }: { contacts: Contact[] }): JSX.Element {
  const st = useContacts.getState();
  const ids = contacts.map((c) => c.id);
  return (
    <div className="contact-multi">
      <div className="contact-multi-avatars">
        {contacts.slice(0, 5).map((c) => (
          <Avatar key={c.id} name={contactName(c)} email={primaryEmail(c)} size={48} />
        ))}
      </div>
      <h2>{contacts.length} Kontakte ausgewählt</h2>
      <div className="contact-actions" style={{ justifyContent: 'center' }}>
        <Button variant="primary" icon={<Mail size={16} />} onClick={() => sendMail(contacts)}>
          E-Mail an alle
        </Button>
        <Button icon={<Star size={16} />} onClick={() => void st.toggleFavorite(ids)}>
          Favorit umschalten
        </Button>
        <Button onClick={() => void exportVcf(ids)}>Exportieren</Button>
        <Button variant="subtle" icon={<Trash2 size={16} />} onClick={() => void st.remove(ids)}>
          Löschen
        </Button>
      </div>
    </div>
  );
}

export function ContactDetail(): JSX.Element {
  const selected = useContacts((s) => s.selected);
  const contacts = useContacts((s) => s.contacts);
  const list = contacts.filter((c) => selected.includes(c.id));
  return (
    <section className="pane contacts-detail">
      <div className="pane-body">
        {list.length === 1 ? (
          <ContactCard contact={list[0]} />
        ) : list.length > 1 ? (
          <MultiSelection contacts={list} />
        ) : (
          <Empty icon={contacts.length ? <UserRound size={48} /> : <Users size={48} />} title="Kein Kontakt ausgewählt">
            Wählen Sie links einen Kontakt aus, um Details, Telefonnummern und die letzten E-Mails zu sehen.
          </Empty>
        )}
      </div>
    </section>
  );
}
