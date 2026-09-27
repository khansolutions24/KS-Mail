// Virtualised message list with date groups, conversation grouping, multi-select, hover actions and drag & drop.

import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import { ArrowDownUp, Check, Clock, Filter, Flag, Mail, MailOpen, Paperclip, Pin, Reply, Forward, Trash2, Search, CloudDownload } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import type { MessageHeader, SortField } from '@shared/types';
import { VIRTUAL } from '@shared/types';
import { api } from '../api/client';
import { Avatar, Button, ContextMenu, Empty, IconButton, Menu, Spinner, type MenuEntry } from '../components/ui';
import { groupLabel, listDate } from '../lib/format';
import { attempt, folderById, useApp } from '../store/app';
import { selectedMessages, useMail } from '../store/mail';
import * as A from './actions';
import { DRAG_TYPE } from './FolderPane';
import { folderLabel } from './folders';
import { snoozeOptions } from '../layout/Overlays';

type Entry = { kind: 'header'; label: string } | { kind: 'msg'; m: MessageHeader; count: number };

const VIRTUAL_LABELS: Record<string, string> = {
  [VIRTUAL.unifiedInbox]: 'Posteingang',
  [VIRTUAL.unread]: 'Ungelesen',
  [VIRTUAL.flagged]: 'Gekennzeichnet',
  [VIRTUAL.snoozed]: 'Zurückgestellt'
};

const SORTS: { id: SortField; label: string }[] = [
  { id: 'date', label: 'Datum' },
  { id: 'from', label: 'Von' },
  { id: 'subject', label: 'Betreff' },
  { id: 'size', label: 'Größe' },
  { id: 'flagged', label: 'Kennzeichnung' }
];

const FILTERS = [
  { id: 'all', label: 'Alle' },
  { id: 'unread', label: 'Ungelesen' },
  { id: 'flagged', label: 'Gekennzeichnet' },
  { id: 'attachments', label: 'Mit Anlagen' }
] as const;

export function messageMenu(m: MessageHeader): MenuEntry[] {
  const s = useApp.getState().settings;
  const list = selectedMessages().some((x) => x.id === m.id) ? selectedMessages() : [m];
  const folder = folderById(m.folderId);
  const multiple = list.length > 1;
  return [
    { label: 'Antworten', icon: <Reply size={16} />, disabled: multiple, onSelect: () => void A.reply('reply', m) },
    { label: 'Allen antworten', disabled: multiple, onSelect: () => void A.reply('replyAll', m) },
    { label: 'Weiterleiten', icon: <Forward size={16} />, disabled: multiple, onSelect: () => void A.reply('forward', m) },
    { separator: true },
    { label: list.every((x) => x.seen) ? 'Als ungelesen markieren' : 'Als gelesen markieren', icon: <MailOpen size={16} />, onSelect: () => void A.setRead(!list.every((x) => x.seen), list) },
    {
      label: 'Kennzeichnen',
      icon: <Flag size={16} />,
      children: [
        { label: list.every((x) => x.flagged) ? 'Kennzeichnung entfernen' : 'Kennzeichnen', onSelect: () => void A.toggleFlag(list) },
        { separator: true },
        { label: 'Heute', onSelect: () => void A.setFlagDue(endOf(0), list) },
        { label: 'Morgen', onSelect: () => void A.setFlagDue(endOf(1), list) },
        { label: 'Diese Woche', onSelect: () => void A.setFlagDue(endOf((5 - new Date().getDay() + 7) % 7), list) },
        { label: 'Nächste Woche', onSelect: () => void A.setFlagDue(endOf(((5 - new Date().getDay() + 7) % 7) + 7), list) }
      ]
    },
    { label: list.every((x) => x.pinned) ? 'Lösen' : 'Anheften', icon: <Pin size={16} />, onSelect: () => void A.togglePin(list) },
    {
      label: 'Kategorisieren',
      children: [
        ...(s?.categories ?? []).map((c) => ({ label: c.name, swatch: c.color, checked: list.every((x) => x.categories.includes(c.name)), onSelect: () => void A.setCategory(c.name, list) })),
        { separator: true },
        { label: 'Alle Kategorien entfernen', onSelect: () => void A.clearCategories(list) },
        { label: 'Kategorien verwalten …', onSelect: () => useApp.getState().openSettings('categories') }
      ]
    },
    {
      label: 'Zurückstellen',
      icon: <Clock size={16} />,
      children: [...snoozeOptions().map((o) => ({ label: o.label, onSelect: () => void A.snoozeUntil(o.at, list) })), { separator: true }, { label: 'Datum wählen …', onSelect: () => A.snooze(list) }]
    },
    ...(s?.quickSteps.length
      ? [{ label: 'QuickSteps', children: s.quickSteps.map((q) => ({ label: q.name, onSelect: () => void A.runQuickStep(q.actions, list) })) }]
      : []),
    { separator: true },
    { label: 'Verschieben nach …', onSelect: () => void A.moveTo(undefined, list) },
    { label: 'Kopieren nach …', onSelect: () => void A.moveTo(undefined, list, true) },
    { label: 'Archivieren', onSelect: () => void A.archive(list) },
    folder?.specialUse === 'junk' ? { label: 'Kein Junk', onSelect: () => void A.junk(false, list) } : { label: 'Als Junk markieren', onSelect: () => void A.junk(true, list) },
    { label: 'Absender blockieren', disabled: multiple, onSelect: () => void A.blockSender(list) },
    { separator: true },
    { label: 'Als Aufgabe hinzufügen', onSelect: () => void A.toTask(list) },
    { label: 'Als Termin planen', disabled: multiple, onSelect: () => void A.toEvent(list) },
    { label: 'Regel erstellen …', disabled: multiple, onSelect: () => void A.newRuleFrom(list) },
    { label: 'In neuem Fenster öffnen', disabled: multiple, onSelect: () => void A.openInWindow(list) },
    { label: 'Als .eml speichern …', disabled: multiple, onSelect: () => void A.saveAs(list) },
    { label: 'Drucken', disabled: multiple, onSelect: () => void A.print(list) },
    { label: 'Quelltext anzeigen', disabled: multiple, onSelect: () => A.showSource(list) },
    { separator: true },
    { label: 'Löschen', icon: <Trash2 size={16} />, danger: true, onSelect: () => void A.remove(false, list) },
    { label: 'Endgültig löschen', danger: true, onSelect: () => void A.remove(true, list) }
  ];
}

function endOf(days: number): number {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(17, 0, 0, 0);
  return d.getTime();
}

function Row({ m, count, selected, focused, isSent }: { m: MessageHeader; count: number; selected: boolean; focused: boolean; isSent: boolean }): JSX.Element {
  const settings = useApp((s) => s.settings);
  const categories = settings?.categories ?? [];
  const accounts = useApp((s) => s.accounts);
  const acc = accounts.length > 1 ? accounts.find((a) => a.id === m.accountId) : undefined;
  const person = isSent ? (m.to[0] ? { name: m.to[0].name || m.to[0].address, address: m.to[0].address } : { name: '(Kein Empfänger)', address: '' }) : { name: m.from.name || m.from.address || '(Unbekannt)', address: m.from.address };
  const onClick = (e: React.MouseEvent): void => {
    const sel = useMail.getState();
    if (e.shiftKey) sel.select(m.id, 'range');
    else if (e.metaKey || e.ctrlKey) sel.select(m.id, 'toggle');
    else sel.select(m.id);
    useApp.getState().setActiveComposer(null);
  };
  return (
    <ContextMenu
      items={() => messageMenu(m)}
      onOpen={() => {
        if (!useMail.getState().selected.includes(m.id)) useMail.getState().select(m.id);
      }}
    >
      <div
        className={clsx('msg-row', !m.seen && 'unread', selected && 'selected', focused && 'focused', m.flagged && 'flagged', m.pinned && 'pinned')}
        onClick={onClick}
        onDoubleClick={() => void A.openInWindow([m])}
        draggable
        onDragStart={(e) => {
          const s = useMail.getState();
          const ids = s.selected.includes(m.id) ? s.selected : [m.id];
          if (!s.selected.includes(m.id)) s.select(m.id);
          e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
          e.dataTransfer.effectAllowed = 'copyMove';
          const ghost = document.createElement('div');
          ghost.className = 'drag-ghost';
          ghost.textContent = ids.length === 1 ? m.subject || '(Ohne Betreff)' : `${ids.length} Nachrichten`;
          document.body.appendChild(ghost);
          e.dataTransfer.setDragImage(ghost, 10, 10);
          setTimeout(() => ghost.remove(), 0);
        }}
      >
        <div className="msg-avatar">
          <Avatar name={person.name} email={person.address} size={32} />
          <span
            className="msg-check"
            onClick={(e) => {
              e.stopPropagation();
              useMail.getState().select(m.id, 'toggle');
            }}
          >
            <Check size={14} />
          </span>
        </div>
        <div className="msg-main">
          <div className="msg-line1">
            <span className="msg-from ellipsis">
              {m.draft && <span className="msg-draft">[Entwurf] </span>}
              {isSent ? `An: ${person.name}` : person.name}
            </span>
            {count > 1 && <span className="msg-count">{count}</span>}
            <span className="msg-icons">
              {m.hasAttachments && <Paperclip size={13} />}
              {m.pinned && <Pin size={13} className="pin-icon" />}
              {m.answered && <Reply size={13} />}
              {m.forwarded && <Forward size={13} />}
              {m.flagged && (
                <span className="msg-flag" title={m.dueAt ? `Fällig: ${listDate(m.dueAt)}` : 'Gekennzeichnet'}>
                  <Flag size={13} fill="currentColor" />
                </span>
              )}
            </span>
          </div>
          <div className="msg-line2">
            <span className="msg-subject ellipsis">{m.subject || '(Ohne Betreff)'}</span>
            <span className="msg-date">{m.snoozedUntil && m.snoozedUntil > Date.now() ? `⏰ ${listDate(m.snoozedUntil)}` : listDate(m.date)}</span>
          </div>
          {(settings?.mail.showSnippet ?? true) && m.snippet && <div className="msg-snippet ellipsis">{m.snippet}</div>}
          {(m.categories.length > 0 || acc) && (
            <div className="msg-tags">
              {acc && (
                <span className="msg-tag" style={{ ['--tag' as string]: acc.color }}>
                  {acc.name}
                </span>
              )}
              {m.categories.map((c) => (
                <span key={c} className="msg-tag" style={{ ['--tag' as string]: categories.find((x) => x.name === c)?.color ?? '#888' }}>
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="msg-hover" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <IconButton small label="Löschen" onClick={() => void A.remove(false, [m])}>
            <Trash2 size={15} />
          </IconButton>
          <IconButton small label={m.seen ? 'Als ungelesen markieren' : 'Als gelesen markieren'} onClick={() => void A.setRead(!m.seen, [m])}>
            {m.seen ? <Mail size={15} /> : <MailOpen size={15} />}
          </IconButton>
          <IconButton small label={m.flagged ? 'Kennzeichnung entfernen' : 'Kennzeichnen'} onClick={() => void A.toggleFlag([m])} className={m.flagged ? 'flag-on' : ''}>
            <Flag size={15} />
          </IconButton>
          <IconButton small label={m.pinned ? 'Lösen' : 'Anheften'} onClick={() => void A.togglePin([m])} className={m.pinned ? 'pin-on' : ''}>
            <Pin size={15} />
          </IconButton>
        </div>
      </div>
    </ContextMenu>
  );
}

export function MessageList(): JSX.Element {
  const s = useMail();
  const settings = useApp((st) => st.settings);
  const folders = useApp((st) => st.folders);
  const hasAccounts = useApp((st) => st.accounts.length > 0);
  const parentRef = useRef<HTMLDivElement>(null);
  const folder = folders.find((f) => f.id === s.folderId);
  const isSent = folder?.specialUse === 'sent' || folder?.specialUse === 'drafts';
  const list = s.serverResults ?? s.items;
  const conversations = settings?.mail.conversationView ?? false;

  const entries = useMemo<Entry[]>(() => {
    let msgs: { m: MessageHeader; count: number }[];
    if (conversations) {
      const byThread = new Map<string, { m: MessageHeader; count: number }>();
      for (const m of list) {
        const k = m.threadKey || String(m.id);
        const e = byThread.get(k);
        if (e) e.count++;
        else byThread.set(k, { m, count: 1 });
      }
      msgs = [...byThread.values()];
    } else msgs = list.map((m) => ({ m, count: 1 }));
    const out: Entry[] = [];
    const grouped = s.sort === 'date' && s.desc;
    let last = '';
    let pinnedDone = false;
    for (const x of msgs) {
      if (grouped) {
        const label = x.m.pinned && !pinnedDone ? 'Angeheftet' : groupLabel(x.m.date);
        if (!x.m.pinned) pinnedDone = true;
        if (label !== last) {
          out.push({ kind: 'header', label });
          last = label;
        }
      }
      out.push({ kind: 'msg', m: x.m, count: x.count });
    }
    return out;
  }, [list, conversations, s.sort, s.desc]);

  const density = settings?.density ?? 'comfortable';
  const rowH = (settings?.mail.showSnippet ?? true ? 76 : 58) + (density === 'compact' ? -10 : density === 'spacious' ? 10 : 0);
  const v = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (entries[i].kind === 'header' ? 32 : rowH + (entries[i].kind === 'msg' && ((entries[i] as { m: MessageHeader }).m.categories.length || useApp.getState().accounts.length > 1) ? 20 : 0)),
    overscan: 12
  });

  // keep the focused row visible
  useEffect(() => {
    const idx = entries.findIndex((e) => e.kind === 'msg' && e.m.id === s.focusedId);
    if (idx >= 0) v.scrollToIndex(idx, { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.focusedId]);

  useEffect(() => {
    parentRef.current?.scrollTo({ top: 0 });
  }, [s.folderId, s.filter, s.search]);

  const title = s.category ? `Kategorie: ${s.category}` : (VIRTUAL_LABELS[s.folderId] ?? (folder ? folderLabel(folder) : ''));
  const selectedSet = new Set(s.selected);
  const unreadCount = folder ? folder.unread : list.filter((m) => !m.seen).length;

  return (
    <div className="pane message-list-pane">
      <div className="list-header">
        <div className="list-title">
          <span className="ellipsis">{title}</span>
          {s.loading && <Spinner />}
        </div>
        <div className="list-tools">
          <div className="list-filter-tabs">
            {FILTERS.slice(0, 2).map((f) => (
              <button key={f.id} className={clsx('tab', s.filter === f.id && 'active')} onClick={() => s.setFilter(f.id)}>
                {f.label}
                {f.id === 'unread' && unreadCount > 0 ? ` (${unreadCount})` : ''}
              </button>
            ))}
          </div>
          <div className="grow" />
          <Menu
            align="end"
            trigger={
              <IconButton small label="Filter" active={s.filter !== 'all' && s.filter !== 'unread'}>
                <Filter size={15} />
              </IconButton>
            }
            items={FILTERS.map((f) => ({ label: f.label, checked: s.filter === f.id, onSelect: () => s.setFilter(f.id) }))}
          />
          <Menu
            align="end"
            trigger={
              <IconButton small label="Sortieren">
                <ArrowDownUp size={15} />
              </IconButton>
            }
            items={[
              { header: 'Sortieren nach' },
              ...SORTS.map((x) => ({ label: x.label, checked: s.sort === x.id, onSelect: () => s.setSort(x.id) })),
              { separator: true },
              { label: 'Absteigend', checked: s.desc, onSelect: () => s.setSort(s.sort, true) },
              { label: 'Aufsteigend', checked: !s.desc, onSelect: () => s.setSort(s.sort, false) },
              { separator: true },
              {
                label: 'Unterhaltungen gruppieren',
                checked: conversations,
                onSelect: () => void useApp.getState().updateSettings({ mail: { ...settings!.mail, conversationView: !conversations } })
              }
            ]}
          />
        </div>
        {s.search && (
          <div className="list-search-info">
            <Search size={13} />
            <span className="grow ellipsis">
              {s.serverResults ? `${s.serverResults.length} Treffer auf dem Server` : `${s.total} Treffer im Cache`} für „{s.search}“
            </span>
            {!s.serverResults ? (
              <Button
                small
                variant="subtle"
                icon={<CloudDownload size={14} />}
                onClick={async () => {
                  const r = await attempt(() => api.mail.serverSearch(s.folderId, s.search));
                  if (r) useMail.getState().setServerResults(r.items);
                }}
              >
                Auf Server suchen
              </Button>
            ) : (
              <Button small variant="subtle" onClick={() => useMail.getState().setServerResults(null)}>
                Lokale Treffer
              </Button>
            )}
          </div>
        )}
      </div>
      <div
        className="message-list"
        ref={parentRef}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            s.moveFocus(e.key === 'ArrowDown' ? 1 : -1, true);
          } else if (e.key === 'Home') {
            e.preventDefault();
            const first = entries.find((x) => x.kind === 'msg');
            if (first?.kind === 'msg') s.select(first.m.id);
          } else if (e.key === 'End') {
            e.preventDefault();
            const last = [...entries].reverse().find((x) => x.kind === 'msg');
            if (last?.kind === 'msg') s.select(last.m.id);
          }
        }}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight > el.scrollHeight - 400 && list.length < s.total) void s.loadMore();
        }}
      >
        {!list.length && !s.loading && (
          <Empty icon={<Mail size={40} />} title={s.search ? 'Keine Treffer' : !hasAccounts ? 'Kein Konto' : 'Hier ist nichts'}>
            {s.search ? 'Versuchen Sie „Auf Server suchen“ oder andere Suchbegriffe.' : s.filter !== 'all' ? 'Keine Nachrichten für diesen Filter.' : !hasAccounts ? 'Fügen Sie ein E-Mail-Konto hinzu.' : 'Dieser Ordner ist leer.'}
          </Empty>
        )}
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((vi) => {
            const e = entries[vi.index];
            return (
              <div key={vi.key} data-index={vi.index} ref={v.measureElement} style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${vi.start}px)` }}>
                {e.kind === 'header' ? (
                  <div className="msg-group">{e.label}</div>
                ) : (
                  <Row m={e.m} count={e.count} selected={selectedSet.has(e.m.id)} focused={s.focusedId === e.m.id} isSent={isSent} />
                )}
              </div>
            );
          })}
        </div>
        {list.length > 0 && list.length >= s.total && !s.folderId.startsWith('virtual:') && !s.search && (folder?.total ?? 0) > list.length && (
          <div className="list-more">
            <Button small variant="subtle" onClick={() => void s.loadMore()}>
              Ältere Nachrichten vom Server laden
            </Button>
          </div>
        )}
      </div>
      {s.selected.length > 1 && (
        <div className="list-selection-bar">
          <span className="grow">{s.selected.length} ausgewählt</span>
          <Button small variant="subtle" onClick={() => s.clearSelection()}>
            Auswahl aufheben
          </Button>
        </div>
      )}
    </div>
  );
}
