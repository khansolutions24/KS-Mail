// Left pane of the contacts module: views, groups and import/export.

import clsx from 'clsx';
import { ArrowDownToLine, ArrowUpFromLine, BookUser, Inbox, Star, Tag, UserPlus, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, Menu } from '../components/ui';
import { useContacts } from './store';
import { allGroups, filterKey, matchesFilter, type ContactFilter } from './contactUtils';
import { exportVcf, importCsv, importVcf } from './actions';
import { emptyContact } from '@shared/vcard';

function NavItem({ filter, icon, label }: { filter: ContactFilter; icon: ReactNode; label: string }): JSX.Element {
  const current = useContacts((s) => s.filter);
  const contacts = useContacts((s) => s.contacts);
  const count = contacts.filter((c) => matchesFilter(c, filter)).length;
  return (
    <div className={clsx('nav-item', filterKey(current) === filterKey(filter) && 'active')} onClick={() => useContacts.getState().setFilter(filter)}>
      {icon}
      <span className="grow ellipsis">{label}</span>
      {count > 0 && <span className="contacts-nav-count">{count}</span>}
    </div>
  );
}

export function ContactsNav(): JSX.Element {
  const contacts = useContacts((s) => s.contacts);
  const groups = allGroups(contacts);
  return (
    <aside className="pane pane-side contacts-nav">
      <div className="contacts-nav-top">
        <Button variant="primary" icon={<UserPlus size={16} />} onClick={() => useContacts.getState().edit(emptyContact())} className="grow">
          Neuer Kontakt
        </Button>
        <Menu
          align="end"
          trigger={
            <Button variant="subtle" title="Importieren/Exportieren" aria-label="Importieren/Exportieren">
              <ArrowDownToLine size={16} />
            </Button>
          }
          items={[
            { header: 'Importieren' },
            { label: 'vCard-Datei (.vcf) …', icon: <ArrowDownToLine size={16} />, onSelect: () => void importVcf() },
            { label: 'CSV-Datei (.csv) …', icon: <ArrowDownToLine size={16} />, onSelect: () => void importCsv() },
            { separator: true },
            { header: 'Exportieren' },
            { label: 'Alle Kontakte als vCard …', icon: <ArrowUpFromLine size={16} />, onSelect: () => void exportVcf() }
          ]}
        />
      </div>
      <div className="pane-body">
        <div className="nav-list">
          <NavItem filter={{ kind: 'all' }} icon={<Users size={18} />} label="Alle Kontakte" />
          <NavItem filter={{ kind: 'favorites' }} icon={<Star size={18} />} label="Favoriten" />
          <NavItem filter={{ kind: 'collected' }} icon={<Inbox size={18} />} label="Gesammelte Adressen" />
        </div>
        <div className="nav-section">
          <BookUser size={14} />
          Gruppen
        </div>
        <div className="nav-list">
          {groups.map((g) => (
            <NavItem key={g} filter={{ kind: 'group', name: g }} icon={<Tag size={18} />} label={g} />
          ))}
          {!groups.length && <div className="contacts-nav-hint">Gruppen entstehen, sobald Sie einem Kontakt im Editor eine Gruppe zuweisen.</div>}
        </div>
      </div>
    </aside>
  );
}
