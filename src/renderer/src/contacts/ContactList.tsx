// Middle pane: alphabetically grouped, multi-selectable contact list.

import clsx from 'clsx';
import { Mail, Pencil, Star, Trash2, Users } from 'lucide-react';
import { Fragment, useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import type { Contact } from '@shared/types';
import { contactName } from '@shared/vcard';
import { Avatar, ContextMenu, Empty, type MenuEntry } from '../components/ui';
import { useContacts } from './store';
import { letterOf, primaryEmail, subtitle } from './contactUtils';
import { exportVcf, sendMail } from './actions';

function ContactRow({ contact, selected, onClick, menu }: { contact: Contact; selected: boolean; onClick: (e: MouseEvent) => void; menu: () => MenuEntry[] }): JSX.Element {
  const name = contactName(contact);
  return (
    <ContextMenu
      items={menu}
      onOpen={() => {
        // right-click on an unselected row selects just that row
        if (!useContacts.getState().selected.includes(contact.id)) useContacts.getState().select([contact.id], contact.id);
      }}
    >
      <div className={clsx('contact-row', selected && 'selected')} data-id={contact.id} onClick={onClick}>
        <Avatar name={name} email={primaryEmail(contact)} size={36} />
        <div className="grow">
          <div className="contact-row-name ellipsis">{name}</div>
          <div className="contact-row-sub ellipsis">{subtitle(contact)}</div>
        </div>
        {contact.favorite && <Star size={14} className="contact-row-star" fill="currentColor" />}
      </div>
    </ContextMenu>
  );
}

export function ContactList({ contacts, title }: { contacts: Contact[]; title: string }): JSX.Element {
  const selected = useContacts((s) => s.selected);
  const search = useContacts((s) => s.search);
  const loaded = useContacts((s) => s.loaded);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sel = new Set(selected);

  // keep the focused row visible when navigating with the keyboard
  const last = selected[selected.length - 1];
  useEffect(() => {
    if (!last) return;
    bodyRef.current?.querySelector(`[data-id="${CSS.escape(last)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [last]);

  const onRowClick = (c: Contact, e: MouseEvent): void => {
    const st = useContacts.getState();
    if (e.shiftKey && st.anchor) {
      const a = contacts.findIndex((x) => x.id === st.anchor);
      const b = contacts.findIndex((x) => x.id === c.id);
      if (a >= 0 && b >= 0) {
        const range = contacts.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.id);
        st.select(e.ctrlKey || e.metaKey ? [...new Set([...st.selected, ...range])] : range, st.anchor);
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      st.select(sel.has(c.id) ? st.selected.filter((id) => id !== c.id) : [...st.selected, c.id], c.id);
      return;
    }
    st.select([c.id], c.id);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const st = useContacts.getState();
    if (e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      void st.remove(st.selected);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!contacts.length) return;
      const idx = contacts.findIndex((x) => x.id === last);
      const next = Math.max(0, Math.min(contacts.length - 1, idx < 0 ? 0 : idx + (e.key === 'ArrowDown' ? 1 : -1)));
      st.select([contacts[next].id], contacts[next].id);
    } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      st.select(contacts.map((c) => c.id), st.anchor);
    } else if (e.key === 'Enter' && selected.length === 1) {
      const c = contacts.find((x) => x.id === selected[0]);
      if (c) st.edit(c);
    }
  };

  const menu = (): MenuEntry[] => {
    const st = useContacts.getState();
    const list = st.contacts.filter((c) => st.selected.includes(c.id));
    const allFav = list.every((c) => c.favorite);
    return [
      { label: 'E-Mail senden', icon: <Mail size={16} />, onSelect: () => sendMail(list) },
      { label: 'Bearbeiten', icon: <Pencil size={16} />, disabled: list.length !== 1, onSelect: () => st.edit(list[0]) },
      { label: allFav ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen', icon: <Star size={16} />, onSelect: () => void st.toggleFavorite(list.map((c) => c.id)) },
      { label: 'Als vCard exportieren …', onSelect: () => void exportVcf(list.map((c) => c.id)) },
      { separator: true },
      { label: 'Löschen', icon: <Trash2 size={16} />, danger: true, shortcut: 'Entf', onSelect: () => void st.remove(list.map((c) => c.id)) }
    ];
  };

  let prevLetter = '';
  return (
    <section className="pane contacts-list">
      <div className="pane-header">
        <div className="pane-title">{title}</div>
        <span className="muted small-text">{contacts.length}</span>
      </div>
      <div className="pane-body" ref={bodyRef} tabIndex={0} onKeyDown={onKeyDown}>
        {loaded && !contacts.length && (
          <Empty icon={<Users size={40} />} title={search ? 'Keine Treffer' : 'Keine Kontakte'}>
            {search ? `Kein Kontakt passt zu „${search}“.` : 'Legen Sie einen neuen Kontakt an oder importieren Sie eine vCard- bzw. CSV-Datei.'}
          </Empty>
        )}
        {contacts.map((c) => {
          const letter = letterOf(c);
          const header = letter !== prevLetter;
          prevLetter = letter;
          return (
            <Fragment key={c.id}>
              {header && <div className="contact-letter">{letter}</div>}
              <ContactRow contact={c} selected={sel.has(c.id)} onClick={(e) => onRowClick(c, e)} menu={menu} />
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
