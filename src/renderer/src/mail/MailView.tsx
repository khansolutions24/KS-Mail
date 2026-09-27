// Mail module: ribbon, folder pane, message list, reading pane / composer. Registers all mail commands.

import clsx from 'clsx';
import {
  Archive,
  Clock,
  Flag,
  FolderInput,
  Forward,
  MailOpen,
  MailPlus,
  Pin,
  RefreshCw,
  Reply,
  ReplyAll,
  ShieldAlert,
  Tag,
  Trash2,
  Zap,
  PanelLeft,
  Columns2,
  Rows2,
  Square,
  Sparkles,
  UserPlus,
  CheckSquare,
  FileText
} from 'lucide-react';
import { useEffect } from 'react';
import { api } from '../api/client';
import { Button, Empty, IconButton, Menu, Splitter, useSplit } from '../components/ui';
import { registerCommands, runCommand, shortcutFor } from '../lib/commands';
import { formatKeys } from '../lib/keys';
import { attempt, pickFolder, prompt, toast, useApp } from '../store/app';
import { selectedMessages, useMail } from '../store/mail';
import * as A from './actions';
import { Composer } from './Composer';
import { FolderPane } from './FolderPane';
import { MessageList } from './MessageList';
import { ReadingPane } from './ReadingPane';
import { fromTemplate, newDraft } from './compose';

function tip(label: string, cmd: string): string {
  const k = formatKeys(shortcutFor(cmd));
  return k ? `${label} (${k})` : label;
}

function Ribbon(): JSX.Element {
  const settings = useApp((s) => s.settings);
  const selCount = useMail((s) => s.selected.length || (s.focusedId !== null ? 1 : 0));
  const none = selCount === 0;
  const pane = settings?.mail.readingPane ?? 'right';
  return (
    <div className="ribbon">
      <div className="send-split">
        <Button variant="primary" icon={<MailPlus size={16} />} title={tip('Neue E-Mail', 'mail.new')} onClick={() => void runCommand('mail.new')}>
          Neue E-Mail
        </Button>
        {(settings?.templates.length ?? 0) > 0 && (
          <Menu
            trigger={
              <button className="btn primary send-split-arrow" aria-label="Aus Vorlage">
                ▾
              </button>
            }
            items={settings!.templates.map((t) => ({
              label: `Vorlage: ${t.name}`,
              icon: <FileText size={15} />,
              onSelect: () => {
                const d = fromTemplate(t.id);
                if (d) useApp.getState().openComposer(d);
              }
            }))}
          />
        )}
      </div>
      <IconButton label={tip('Löschen', 'mail.delete')} disabled={none} onClick={() => void A.remove()}>
        <Trash2 size={18} />
      </IconButton>
      <IconButton label={tip('Archivieren', 'mail.archive')} disabled={none} onClick={() => void A.archive()}>
        <Archive size={18} />
      </IconButton>
      <IconButton label={tip('Junk', 'mail.junk')} disabled={none} onClick={() => void A.junk(true)}>
        <ShieldAlert size={18} />
      </IconButton>
      <IconButton label={tip('Verschieben nach …', 'mail.move')} disabled={none} onClick={() => void A.moveTo()}>
        <FolderInput size={18} />
      </IconButton>
      <span className="ribbon-sep" />
      <Button variant="subtle" icon={<Reply size={17} />} disabled={selCount !== 1} title={tip('Antworten', 'mail.reply')} onClick={() => void A.reply('reply')}>
        Antworten
      </Button>
      <IconButton label={tip('Allen antworten', 'mail.replyAll')} disabled={selCount !== 1} onClick={() => void A.reply('replyAll')}>
        <ReplyAll size={18} />
      </IconButton>
      <IconButton label={tip('Weiterleiten', 'mail.forward')} disabled={selCount !== 1} onClick={() => void A.reply('forward')}>
        <Forward size={18} />
      </IconButton>
      <span className="ribbon-sep" />
      <IconButton label={tip('Gelesen/Ungelesen', 'mail.markRead')} disabled={none} onClick={() => void A.setRead(!selectedMessages().every((m) => m.seen))}>
        <MailOpen size={18} />
      </IconButton>
      <IconButton label={tip('Kennzeichnen', 'mail.toggleFlag')} disabled={none} onClick={() => void A.toggleFlag()}>
        <Flag size={18} />
      </IconButton>
      <IconButton label="Anheften" disabled={none} onClick={() => void A.togglePin()}>
        <Pin size={18} />
      </IconButton>
      <Menu
        trigger={
          <IconButton label="Kategorisieren" disabled={none}>
            <Tag size={18} />
          </IconButton>
        }
        items={[
          ...(settings?.categories ?? []).map((c) => ({ label: c.name, swatch: c.color, onSelect: () => void A.setCategory(c.name) })),
          { separator: true },
          { label: 'Alle Kategorien entfernen', onSelect: () => void A.clearCategories() },
          { label: 'Kategorien verwalten …', onSelect: () => useApp.getState().openSettings('categories') }
        ]}
      />
      <IconButton label="Zurückstellen" disabled={none} onClick={() => A.snooze()}>
        <Clock size={18} />
      </IconButton>
      <Menu
        trigger={
          <Button variant="subtle" icon={<Zap size={17} />} disabled={none}>
            QuickSteps
          </Button>
        }
        items={[
          ...(settings?.quickSteps ?? []).map((q) => ({ label: q.name, onSelect: () => void A.runQuickStep(q.actions) })),
          { separator: true },
          { label: 'QuickSteps verwalten …', onSelect: () => useApp.getState().openSettings('quicksteps') }
        ]}
      />
      <IconButton label="Als Aufgabe hinzufügen" disabled={none} onClick={() => void A.toTask()}>
        <CheckSquare size={18} />
      </IconButton>
      <span className="ribbon-sep" />
      <IconButton label={tip('Senden/Empfangen', 'mail.sync')} onClick={() => void runCommand('mail.sync')}>
        <RefreshCw size={18} />
      </IconButton>
      <div className="grow" />
      <IconButton label={tip('Ordnerbereich', 'view.toggleFolders')} onClick={() => useApp.getState().toggleFolders()}>
        <PanelLeft size={18} />
      </IconButton>
      <Menu
        align="end"
        trigger={
          <IconButton label="Lesebereich">
            {pane === 'bottom' ? <Rows2 size={18} /> : pane === 'off' ? <Square size={18} /> : <Columns2 size={18} />}
          </IconButton>
        }
        items={[
          { label: 'Lesebereich rechts', checked: pane === 'right', onSelect: () => void runCommand('view.readingRight') },
          { label: 'Lesebereich unten', checked: pane === 'bottom', onSelect: () => void runCommand('view.readingBottom') },
          { label: 'Lesebereich aus', checked: pane === 'off', onSelect: () => void runCommand('view.readingOff') },
          { separator: true },
          { label: 'Unterhaltungen gruppieren', checked: settings?.mail.conversationView, onSelect: () => void runCommand('view.toggleConversations') },
          { label: 'Vorschautext anzeigen', checked: settings?.mail.showSnippet, onSelect: () => void useApp.getState().updateSettings({ mail: { ...settings!.mail, showSnippet: !settings!.mail.showSnippet } }) }
        ]}
      />
    </div>
  );
}

function Welcome(): JSX.Element {
  return (
    <div className="welcome">
      <Empty icon={<Sparkles size={48} />} title="Willkommen bei KS Mail">
        <p style={{ maxWidth: 460, lineHeight: 1.5 }}>
          E-Mail, Kalender, Kontakte, Aufgaben und Notizen in einer App. Fügen Sie Ihr E-Mail-Konto hinzu (IMAP/SMTP, Gmail, Outlook.com, iCloud, GMX, WEB.DE, T-Online …) oder probieren Sie alles mit einem Demo-Konto aus.
        </p>
        <div className="row" style={{ marginTop: 8 }}>
          <Button variant="primary" icon={<UserPlus size={16} />} onClick={() => void runCommand('account.add')}>
            Konto hinzufügen
          </Button>
          <Button onClick={() => void runCommand('account.addDemo')}>Demo-Konto ausprobieren</Button>
        </div>
        <p className="muted small-text" style={{ marginTop: 16 }}>
          Tipp: Mit {formatKeys(shortcutFor('nav.palette'))} öffnen Sie die Befehlspalette – damit steuern Sie die gesamte App per Tastatur.
        </p>
      </Empty>
    </div>
  );
}

function useMailCommands(): void {
  useEffect(
    () =>
      registerCommands({
        'mail.reply': () => A.reply('reply'),
        'mail.replyAll': () => A.reply('replyAll'),
        'mail.forward': () => A.reply('forward'),
        'mail.delete': () => A.remove(false),
        'mail.deletePermanent': () => A.remove(true),
        'mail.archive': () => A.archive(),
        'mail.move': () => A.moveTo(),
        'mail.copy': () => A.moveTo(undefined, undefined, true),
        'mail.markRead': () => A.setRead(true),
        'mail.markUnread': () => A.setRead(false),
        'mail.toggleFlag': () => A.toggleFlag(),
        'mail.pin': () => A.togglePin(),
        'mail.snooze': () => A.snooze(),
        'mail.junk': () => A.junk(true),
        'mail.notJunk': () => A.junk(false),
        'mail.block': () => A.blockSender(),
        'mail.category': async () => {
          const cats = useApp.getState().settings?.categories ?? [];
          if (!cats.length) return;
          const name = await prompt('Kategorie zuweisen', cats[0].name, `Verfügbar: ${cats.map((c) => c.name).join(', ')}`);
          if (name && cats.some((c) => c.name === name)) await A.setCategory(name);
        },
        'mail.toTask': () => A.toTask(),
        'mail.toEvent': () => A.toEvent(),
        'mail.print': () => A.print(),
        'mail.saveAs': () => A.saveAs(),
        'mail.source': () => A.showSource(),
        'mail.importEml': async () => {
          const folderId = useMail.getState().folderId;
          const target = folderId.startsWith('virtual:') ? await pickFolder('In welchen Ordner importieren?') : folderId;
          if (!target) return;
          const n = await attempt(() => api.mail.importEml(target));
          if (n) toast('success', `${n} Nachricht(en) importiert`);
        },
        'mail.unsubscribe': () => A.unsubscribe(),
        'mail.selectAll': () => useMail.getState().selectAll(),
        'mail.next': () => useMail.getState().moveFocus(1),
        'mail.prev': () => useMail.getState().moveFocus(-1),
        'mail.open': () => A.openInWindow(),
        'mail.markFolderRead': () => A.markFolderRead(useMail.getState().folderId),
        'mail.emptyTrash': async () => {
          const trash = useApp.getState().folders.filter((f) => f.specialUse === 'trash');
          const f = trash.find((t) => t.id === useMail.getState().folderId) ?? trash[0];
          if (f) await A.emptyFolder(f.id);
        },
        'mail.newFolder': async () => {
          const acc = useApp.getState().accounts.find((a) => a.enabled);
          const cur = useApp.getState().folders.find((f) => f.id === useMail.getState().folderId);
          if (acc) await A.newFolder(cur?.accountId ?? acc.id, null);
        },
        'mail.filterUnread': () => useMail.getState().setFilter('unread'),
        'mail.filterFlagged': () => useMail.getState().setFilter('flagged'),
        'mail.filterAll': () => useMail.getState().setFilter('all'),
        'mail.runRules': async () => {
          const f = useMail.getState().folderId;
          const target = f.startsWith('virtual:') ? await pickFolder('Regeln ausführen für Ordner') : f;
          if (!target) return;
          const n = await attempt(() => api.settings.runRules(target));
          if (n !== undefined) toast('success', `${n} Nachricht(en) durch Regeln verarbeitet`);
        },
        'mail.newRule': () => A.newRuleFrom()
      }),
    []
  );
}

export function MailView(): JSX.Element {
  const accounts = useApp((s) => s.accounts);
  const showFolders = useApp((s) => s.showFolders);
  const pane = useApp((s) => s.settings?.mail.readingPane ?? 'right');
  const composers = useApp((s) => s.composers);
  const active = useApp((s) => s.activeComposer);
  const composer = composers.find((c) => c.id === active) ?? null;
  const [folderW, startFolder, dragFolder] = useSplit('folders', 250, 180, 420);
  const [listW, startList, dragList] = useSplit('list', 400, 280, 800);
  const [listH, startListH, dragListH] = useSplit('listH', 320, 150, 900);
  useMailCommands();

  useEffect(() => {
    if (!useMail.getState().items.length) void useMail.getState().load();
  }, []);

  if (!accounts.length && !composers.length) return <Welcome />;

  const detail = composer ? (
    <Composer key={composer.id} draft={composer} onClose={() => useApp.getState().closeComposer(composer.id)} />
  ) : (
    <ReadingPane />
  );

  return (
    <div className="mail-view">
      <Ribbon />
      <div className="mail-body">
        {showFolders && (
          <>
            <div className="pane-side folder-column" style={{ width: folderW }}>
              <FolderPane />
            </div>
            <Splitter onPointerDown={(e) => startFolder(e)} dragging={dragFolder} />
          </>
        )}
        {pane === 'right' && (
          <>
            <div className="list-column" style={{ width: listW }}>
              <MessageList />
            </div>
            <Splitter onPointerDown={(e) => startList(e)} dragging={dragList} />
            <div className="detail-column">{detail}</div>
          </>
        )}
        {pane === 'bottom' && (
          <div className="stack-column">
            <div className="list-column" style={{ height: listH, width: 'auto' }}>
              <MessageList />
            </div>
            <Splitter horizontal onPointerDown={(e) => startListH(e, false, true)} dragging={dragListH} />
            <div className="detail-column">{detail}</div>
          </div>
        )}
        {pane === 'off' && <div className={clsx('detail-column')}>{composer ? detail : <MessageList />}</div>}
      </div>
      {composers.length > 0 && (
        <div className="composer-tabs">
          {composers.map((c) => (
            <button key={c.id} className={clsx('composer-tab', c.id === active && 'active')} onClick={() => useApp.getState().setActiveComposer(c.id === active ? null : c.id)}>
              <MailPlus size={14} />
              <span className="ellipsis">{c.subject || '(Ohne Betreff)'}</span>
            </button>
          ))}
          <button className="composer-tab" onClick={() => useApp.getState().openComposer(newDraft())} title="Weitere neue E-Mail">
            +
          </button>
        </div>
      )}
    </div>
  );
}
