// Folder pane: favourites, smart views, account folder trees, categories. Folders are drop targets for messages.

import clsx from 'clsx';
import { Bell, ChevronDown, ChevronRight, Clock, Flag, Inbox, MailOpen, Plus, Tag } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Account, Folder } from '@shared/types';
import { VIRTUAL } from '@shared/types';
import { api } from '../api/client';
import { ContextMenu, type MenuEntry } from '../components/ui';
import { attempt, toast, useApp } from '../store/app';
import { useMail } from '../store/mail';
import * as A from './actions';
import { folderIcon, folderLabel, folderTree, type FolderNode } from './folders';

export const DRAG_TYPE = 'application/x-ksmail-ids';

function readCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem('folders.collapsed') ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function useCollapsed(): [Set<string>, (id: string) => void] {
  const [set, setSet] = useState(readCollapsed);
  const toggle = (id: string): void => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSet(next);
    try {
      localStorage.setItem('folders.collapsed', JSON.stringify([...next]));
    } catch {
      // ignore
    }
  };
  return [set, toggle];
}

function useDrop(folderId: string | null): { over: boolean; props: React.HTMLAttributes<HTMLDivElement> } {
  const [over, setOver] = useState(false);
  if (!folderId) return { over: false, props: {} };
  return {
    over,
    props: {
      onDragOver: (e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = e.ctrlKey || e.altKey ? 'copy' : 'move';
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e) => {
        setOver(false);
        const raw = e.dataTransfer.getData(DRAG_TYPE);
        if (!raw) return;
        e.preventDefault();
        const idList = JSON.parse(raw) as number[];
        const list = (useMail.getState().serverResults ?? useMail.getState().items).filter((m) => idList.includes(m.id));
        void A.moveTo(folderId, list, e.ctrlKey || e.altKey);
      }
    }
  };
}

function Item({
  id,
  icon,
  label,
  count,
  countKind = 'unread',
  depth = 0,
  expander,
  menu,
  dropId,
  color
}: {
  id: string;
  icon: ReactNode;
  label: string;
  count?: number;
  countKind?: 'unread' | 'total';
  depth?: number;
  expander?: ReactNode;
  menu?: () => MenuEntry[];
  dropId?: string | null;
  color?: string;
}): JSX.Element {
  const active = useMail((s) => s.folderId === id && !s.category);
  const drop = useDrop(dropId ?? null);
  const el = (
    <div
      className={clsx('nav-item folder-item', active && 'active', drop.over && 'drop-over')}
      style={{ paddingLeft: 6 + depth * 14 }}
      onClick={() => {
        useApp.getState().setActiveComposer(null);
        if (useMail.getState().folderId !== id || useMail.getState().category) useMail.getState().setFolder(id);
        if (!id.startsWith('virtual:')) void api.mail.sync(undefined, id).catch(() => undefined);
      }}
      title={label}
      {...drop.props}
    >
      <span className="folder-expander">{expander}</span>
      {color ? <span className="color-dot" style={{ background: color }} /> : icon}
      <span className="grow ellipsis">{label}</span>
      {!!count && <span className={clsx('count', countKind === 'total' && 'total')}>{count}</span>}
    </div>
  );
  return menu ? <ContextMenu items={menu}>{el}</ContextMenu> : el;
}

function folderMenu(f: Folder): MenuEntry[] {
  const entries: MenuEntry[] = [
    { label: 'Synchronisieren', onSelect: () => void attempt(() => api.mail.sync(f.accountId, f.id)) },
    { label: 'Alle als gelesen markieren', onSelect: () => void A.markFolderRead(f.id) },
    { label: f.favorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen', onSelect: () => void attempt(() => api.mail.setFavorite(f.id, !f.favorite)) },
    { separator: true },
    { label: 'Neuer Unterordner …', onSelect: () => void A.newFolder(f.accountId, f.path) },
    { label: 'Umbenennen …', disabled: !!f.specialUse, onSelect: () => void A.renameFolder(f.id) },
    { label: 'Ordner löschen', danger: true, disabled: !!f.specialUse, onSelect: () => void A.deleteFolder(f.id) },
    { separator: true },
    {
      label: 'Regeln jetzt ausführen',
      onSelect: async () => {
        const n = await attempt(() => api.settings.runRules(f.id));
        if (n !== undefined) toast('success', `${n} Nachricht(en) durch Regeln verarbeitet`);
      }
    },
    {
      label: '.eml-Dateien importieren …',
      onSelect: async () => {
        const n = await attempt(() => api.mail.importEml(f.id));
        if (n) toast('success', `${n} Nachricht(en) importiert`);
      }
    }
  ];
  if (f.specialUse === 'trash' || f.specialUse === 'junk') entries.push({ separator: true }, { label: 'Ordner leeren', danger: true, onSelect: () => void A.emptyFolder(f.id) });
  return entries;
}

function Tree({ nodes, depth, collapsed, toggle }: { nodes: FolderNode[]; depth: number; collapsed: Set<string>; toggle: (id: string) => void }): JSX.Element {
  return (
    <>
      {nodes.map((n) => {
        const f = n.folder;
        const Icon = folderIcon(f);
        const open = !collapsed.has(f.id);
        return (
          <div key={f.id}>
            {f.selectable ? (
              <Item
                id={f.id}
                icon={<Icon size={16} />}
                label={folderLabel(f)}
                count={f.specialUse === 'drafts' ? f.total : f.specialUse === 'sent' || f.specialUse === 'trash' ? 0 : f.unread}
                countKind={f.specialUse === 'drafts' ? 'total' : 'unread'}
                depth={depth}
                dropId={f.id}
                menu={() => folderMenu(f)}
                expander={
                  n.children.length ? (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(f.id);
                      }}
                    >
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                  ) : null
                }
              />
            ) : (
              <div className="nav-item folder-item" style={{ paddingLeft: 6 + depth * 14 }} onClick={() => toggle(f.id)}>
                <span className="folder-expander">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                <Icon size={16} />
                <span className="grow ellipsis muted">{f.name}</span>
              </div>
            )}
            {open && n.children.length > 0 && <Tree nodes={n.children} depth={depth + 1} collapsed={collapsed} toggle={toggle} />}
          </div>
        );
      })}
    </>
  );
}

function AccountSection({ account, folders, collapsed, toggle }: { account: Account; folders: Folder[]; collapsed: Set<string>; toggle: (id: string) => void }): JSX.Element {
  const open = !collapsed.has('acc:' + account.id);
  const sync = useApp((s) => s.sync[account.id]);
  const menu = (): MenuEntry[] => [
    { label: 'Synchronisieren', onSelect: () => void attempt(() => api.mail.sync(account.id)) },
    { label: 'Neuer Ordner …', onSelect: () => void A.newFolder(account.id, null) },
    { separator: true },
    { label: 'Kontoeinstellungen …', onSelect: () => useApp.getState().openSettings('accounts') }
  ];
  return (
    <div className="account-section">
      <ContextMenu items={menu}>
        <div className="nav-section account-header" onClick={() => toggle('acc:' + account.id)} title={account.email}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="color-dot" style={{ background: account.color }} />
          <span className="grow ellipsis">{account.name || account.email}</span>
          {sync?.status === 'syncing' && <span className="spinner" style={{ width: 12, height: 12 }} />}
          {(sync?.status === 'error' || sync?.status === 'offline') && (
            <span className="account-error" title={sync.message}>
              !
            </span>
          )}
        </div>
      </ContextMenu>
      {open && (
        <div className="nav-list">
          {!folders.length && <div className="muted small-text" style={{ padding: '4px 12px' }}>{sync?.status === 'error' ? sync.message : 'Wird geladen …'}</div>}
          <Tree nodes={folderTree(folders)} depth={0} collapsed={collapsed} toggle={toggle} />
          <div className="nav-item folder-item muted" style={{ paddingLeft: 6 }} onClick={() => void A.newFolder(account.id, null)}>
            <span className="folder-expander" />
            <Plus size={16} />
            <span>Neuer Ordner</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function FolderPane(): JSX.Element {
  const accounts = useApp((s) => s.accounts);
  const folders = useApp((s) => s.folders);
  const categories = useApp((s) => s.settings?.categories ?? []);
  const activeCategory = useMail((s) => s.category);
  const [collapsed, toggle] = useCollapsed();
  const enabled = accounts.filter((a) => a.enabled);
  const inboxUnread = folders.filter((f) => f.specialUse === 'inbox' && enabled.some((a) => a.id === f.accountId)).reduce((n, f) => n + f.unread, 0);
  const favorites = folders.filter((f) => f.favorite);
  const favOpen = !collapsed.has('favorites');

  return (
    <div className="folder-pane">
      <div className="nav-section" onClick={() => toggle('favorites')}>
        {favOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Favoriten</span>
      </div>
      {favOpen && (
        <div className="nav-list">
          <Item id={VIRTUAL.unifiedInbox} icon={<Inbox size={16} />} label={enabled.length > 1 ? 'Alle Posteingänge' : 'Posteingang'} count={inboxUnread} />
          <Item id={VIRTUAL.unread} icon={<MailOpen size={16} />} label="Ungelesen" />
          <Item id={VIRTUAL.flagged} icon={<Flag size={16} />} label="Gekennzeichnet" />
          <Item id={VIRTUAL.snoozed} icon={<Clock size={16} />} label="Zurückgestellt" />
          {favorites.map((f) => {
            const Icon = folderIcon(f);
            return <Item key={f.id} id={f.id} icon={<Icon size={16} />} label={folderLabel(f)} count={f.unread} dropId={f.id} menu={() => folderMenu(f)} />;
          })}
        </div>
      )}
      {enabled.map((a) => (
        <AccountSection
          key={a.id}
          account={a}
          folders={folders.filter((f) => f.accountId === a.id)}
          collapsed={collapsed}
          toggle={toggle}
        />
      ))}
      {categories.length > 0 && (
        <>
          <div className="nav-section" onClick={() => toggle('categories')}>
            {!collapsed.has('categories') ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Tag size={13} />
            <span>Kategorien</span>
          </div>
          {!collapsed.has('categories') && (
            <div className="nav-list">
              {categories.map((c) => (
                <div
                  key={c.name}
                  className={clsx('nav-item folder-item', activeCategory === c.name && 'active')}
                  style={{ paddingLeft: 6 }}
                  onClick={() => {
                    const m = useMail.getState();
                    if (m.category === c.name) m.setCategory(null);
                    else {
                      if (!m.folderId.startsWith('virtual:')) m.setFolder(VIRTUAL.unifiedInbox);
                      useMail.getState().setCategory(c.name);
                    }
                  }}
                >
                  <span className="folder-expander" />
                  <span className="color-dot" style={{ background: c.color }} />
                  <span className="grow ellipsis">{c.name}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {!enabled.length && (
        <div className="folder-empty">
          <Bell size={16} />
          <span>Noch kein Konto eingerichtet.</span>
        </div>
      )}
    </div>
  );
}
