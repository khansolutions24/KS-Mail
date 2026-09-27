// Contacts module (Outlook "Personen"): navigation, list and contact card.

import { useEffect, useMemo, useRef } from 'react';
import { emptyContact } from '@shared/vcard';
import { onEvent } from '../api/client';
import { registerCommands } from '../lib/commands';
import { useIntentHandler } from '../store/intent';
import { Splitter, useSplit } from '../components/ui';
import { useContacts } from './store';
import { filterTitle, matchesFilter, matchesSearch, sortContacts } from './contactUtils';
import { exportVcf, importCsv, importVcf } from './actions';
import { ContactsNav } from './ContactsNav';
import { ContactList } from './ContactList';
import { ContactDetail } from './ContactDetail';
import { ContactEditor } from './ContactEditor';

export function ContactsView(): JSX.Element {
  const contacts = useContacts((s) => s.contacts);
  const filter = useContacts((s) => s.filter);
  const search = useContacts((s) => s.search);
  const [navW, startNav, dragNav] = useSplit('contacts-nav', 220, 160, 360);
  const [listW, startList, dragList] = useSplit('contacts-list', 340, 240, 560);
  /** Contact id requested by an intent before the list was loaded */
  const pendingOpen = useRef<string | null>(null);

  useEffect(() => {
    const st = useContacts.getState();
    void st.load().then(() => {
      const id = pendingOpen.current;
      pendingOpen.current = null;
      if (id) openContact(id);
    });
    const onSearch = (e: Event): void => useContacts.getState().setSearch((e as CustomEvent<string>).detail ?? '');
    window.addEventListener('ksmail:search', onSearch);
    const offEvent = onEvent('contacts:changed', () => void useContacts.getState().load());
    const offCmds = registerCommands({
      'contacts.importVcf': importVcf,
      'contacts.importCsv': importCsv,
      'contacts.exportVcf': () => exportVcf()
    });
    return () => {
      window.removeEventListener('ksmail:search', onSearch);
      offEvent();
      offCmds();
    };
  }, []);

  useIntentHandler('contacts', (action, arg) => {
    if (action === 'newContact') useContacts.getState().edit(emptyContact());
    else if (action === 'openContact' && arg) {
      if (useContacts.getState().loaded) openContact(arg);
      else pendingOpen.current = arg;
    }
  });

  const visible = useMemo(() => sortContacts(contacts.filter((c) => matchesFilter(c, filter) && matchesSearch(c, search))), [contacts, filter, search]);

  return (
    <div className="contacts-view">
      <div style={{ width: navW, flex: 'none', display: 'flex' }}>
        <ContactsNav />
      </div>
      <Splitter onPointerDown={(e) => startNav(e)} dragging={dragNav} />
      <div style={{ width: listW, flex: 'none', display: 'flex' }}>
        <ContactList contacts={visible} title={search ? `Suchergebnisse – ${filterTitle(filter)}` : filterTitle(filter)} />
      </div>
      <Splitter onPointerDown={(e) => startList(e)} dragging={dragList} />
      <ContactDetail />
      <ContactEditor />
    </div>
  );
}

/** Selects a contact, switching to a view that contains it */
function openContact(id: string): void {
  const st = useContacts.getState();
  const c = st.contacts.find((x) => x.id === id);
  if (!c) return;
  if (!matchesFilter(c, st.filter)) st.setFilter(c.collected ? { kind: 'collected' } : { kind: 'all' });
  st.setSearch('');
  st.select([id], id);
}
