// Reading pane: message header, actions, invitation card, attachments, body; conversation view; multi-selection summary.

import clsx from 'clsx';
import {
  Archive,
  CalendarCheck,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  File,
  FileImage,
  FileText,
  Flag,
  Forward,
  ImageOff,
  Mail,
  MoreHorizontal,
  Reply,
  ReplyAll,
  Trash2,
  MailX,
  FolderInput
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AttachmentInfo, CalendarEvent, MessageBody, MessageHeader } from '@shared/types';
import { formatAddress, formatBytes } from '@shared/util';
import { api, errorMessage } from '../api/client';
import { Avatar, Button, Empty, IconButton, Menu, Spinner, ContextMenu } from '../components/ui';
import { longDate, time } from '../lib/format';
import { runCommand } from '../lib/commands';
import { attempt, toast, useApp } from '../store/app';
import { selectedMessages, useMail } from '../store/mail';
import * as A from './actions';
import { BodyFrame } from './BodyFrame';
import { messageMenu } from './MessageList';
import { newDraft } from './compose';

function useBody(id: number | null): { body: MessageBody | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ body: MessageBody | null; error: string | null; loading: boolean }>({ body: null, error: null, loading: false });
  useEffect(() => {
    if (id === null) return;
    let alive = true;
    setState({ body: null, error: null, loading: true });
    api.mail
      .body(id)
      .then((body) => alive && setState({ body, error: null, loading: false }))
      .catch((err) => alive && setState({ body: null, error: errorMessage(err), loading: false }));
    return () => {
      alive = false;
    };
  }, [id]);
  return state;
}

function useRemoteAllowed(m: MessageHeader | null): [boolean, () => void] {
  const settings = useApp((s) => s.settings);
  const [once, setOnce] = useState<number | null>(null);
  const [contact, setContact] = useState(false);
  const policy = settings?.mail.remoteImages ?? 'ask';
  useEffect(() => {
    setContact(false);
    if (!m || policy !== 'contacts') return;
    void api.contacts.byEmail(m.from.address).then((c) => setContact(!!c && !c.collected));
  }, [m?.id, policy]);
  if (!m) return [false, () => undefined];
  const safe = settings?.safeSenders.some((s) => s.toLowerCase() === m.from.address.toLowerCase() || (s.startsWith('@') && m.from.address.toLowerCase().endsWith(s.toLowerCase())));
  const allowed = policy === 'always' || once === m.id || !!safe || (policy === 'contacts' && contact);
  return [allowed, () => setOnce(m.id)];
}

function attachmentIcon(a: AttachmentInfo): JSX.Element {
  if (a.contentType.startsWith('image/')) return <FileImage size={20} />;
  if (a.contentType.startsWith('text/') || a.contentType.includes('pdf') || a.contentType.includes('word')) return <FileText size={20} />;
  return <File size={20} />;
}

function Attachments({ m, list }: { m: MessageHeader; list: AttachmentInfo[] }): JSX.Element | null {
  const files = list.filter((a) => !a.inline);
  if (!files.length) return null;
  return (
    <div className="attachments">
      {files.map((a) => (
        <ContextMenu
          key={a.index}
          items={[
            { label: 'Öffnen', onSelect: () => void attempt(() => api.mail.openAttachment(m.id, a.index)) },
            { label: 'Speichern unter …', onSelect: () => void attempt(() => api.mail.saveAttachment(m.id, a.index)) },
            { label: 'Alle speichern …', onSelect: () => void attempt(() => api.mail.saveAllAttachments(m.id)) },
            ...(a.contentType === 'text/calendar' ? [{ label: 'In Kalender importieren', onSelect: () => void importIcs(m.id, a.index) }] : [])
          ]}
        >
          <div className="attachment" title={`${a.filename} (${formatBytes(a.size)})`} onDoubleClick={() => void attempt(() => api.mail.openAttachment(m.id, a.index))}>
            <span className="attachment-icon">{attachmentIcon(a)}</span>
            <span className="attachment-name">
              <span className="ellipsis">{a.filename}</span>
              <span className="muted small-text">{formatBytes(a.size)}</span>
            </span>
            <IconButton small label="Speichern" onClick={() => void attempt(() => api.mail.saveAttachment(m.id, a.index))}>
              <Download size={14} />
            </IconButton>
          </div>
        </ContextMenu>
      ))}
      {files.length > 1 && (
        <Button small variant="subtle" icon={<Download size={14} />} onClick={() => void attempt(() => api.mail.saveAllAttachments(m.id))}>
          Alle speichern
        </Button>
      )}
    </div>
  );
}

async function importIcs(messageId: number, index: number): Promise<void> {
  const data = await attempt(() => api.mail.attachmentData(messageId, index));
  if (!data) return;
  const cal = useApp.getState().settings?.calendar.defaultCalendarId ?? 'default';
  const n = await attempt(() => api.calendar.importIcs(cal, atob(data.dataBase64)));
  if (n !== undefined) toast('success', `${n} Termin(e) importiert`);
}

function InviteCard({ m, events }: { m: MessageHeader; events: CalendarEvent[] }): JSX.Element {
  const ev = events[0];
  const accounts = useApp((s) => s.accounts);
  const me = accounts.find((a) => a.id === m.accountId)?.email.toLowerCase();
  const myStatus = ev.attendees.find((a) => a.email.toLowerCase() === me)?.status;
  const [busy, setBusy] = useState(false);
  const respond = async (r: 'accepted' | 'declined' | 'tentative'): Promise<void> => {
    setBusy(true);
    const cal = useApp.getState().settings?.calendar.defaultCalendarId ?? 'default';
    await attempt(() => api.calendar.respond(m.id, r, cal), r === 'accepted' ? 'Zugesagt – Termin im Kalender eingetragen' : r === 'tentative' ? 'Mit Vorbehalt zugesagt' : 'Abgesagt');
    setBusy(false);
  };
  const same = new Date(ev.start).toDateString() === new Date(ev.end).toDateString();
  return (
    <div className="invite-card">
      <div className="invite-date">
        <span className="invite-month">{new Date(ev.start).toLocaleDateString('de-DE', { month: 'short' })}</span>
        <span className="invite-day">{new Date(ev.start).getDate()}</span>
        <span className="invite-weekday">{new Date(ev.start).toLocaleDateString('de-DE', { weekday: 'short' })}</span>
      </div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="invite-title">{ev.title}</div>
        <div className="muted small-text">
          {ev.allDay ? 'Ganztägig' : same ? `${time(ev.start)} – ${time(ev.end)}` : `${longDate(ev.start)} – ${longDate(ev.end)}`}
          {ev.location ? ` · ${ev.location}` : ''}
        </div>
        {ev.organizer && <div className="muted small-text">Organisator: {ev.organizer.name || ev.organizer.address}</div>}
        {myStatus && myStatus !== 'needs-action' && <div className="small-text" style={{ color: 'var(--success)' }}>Ihre Antwort: {{ accepted: 'Zugesagt', declined: 'Abgesagt', tentative: 'Mit Vorbehalt' }[myStatus]}</div>}
        <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          <Button small variant="primary" disabled={busy} icon={<CalendarCheck size={14} />} onClick={() => void respond('accepted')}>
            Zusagen
          </Button>
          <Button small disabled={busy} onClick={() => void respond('tentative')}>
            Mit Vorbehalt
          </Button>
          <Button small disabled={busy} onClick={() => void respond('declined')}>
            Absagen
          </Button>
          <Button small variant="subtle" icon={<CalendarDays size={14} />} onClick={() => void runCommand('nav.calendar')}>
            Kalender
          </Button>
        </div>
      </div>
    </div>
  );
}

function Recipients({ label, list }: { label: string; list: { name: string; address: string }[] }): JSX.Element | null {
  const [all, setAll] = useState(false);
  if (!list.length) return null;
  const shown = all ? list : list.slice(0, 4);
  return (
    <div className="recipients small-text">
      <span className="muted">{label}: </span>
      {shown.map((a, i) => (
        <span key={i} className="recipient" title={formatAddress(a)} onClick={() => useApp.getState().openComposer(newDraft({ to: [a] }))}>
          {a.name || a.address}
          {i < shown.length - 1 ? '; ' : ''}
        </span>
      ))}
      {list.length > 4 && !all && (
        <button className="link-btn" onClick={() => setAll(true)}>
          +{list.length - 4} weitere
        </button>
      )}
    </div>
  );
}

function MessageCard({ m, expanded, onToggle, standalone }: { m: MessageHeader; expanded: boolean; onToggle?: () => void; standalone?: boolean }): JSX.Element {
  const { body, error, loading } = useBody(expanded ? m.id : null);
  const [allowed, allowOnce] = useRemoteAllowed(m);
  const settings = useApp((s) => s.settings);
  const categories = settings?.categories ?? [];

  if (!expanded) {
    return (
      <div className="msg-card collapsed" onClick={onToggle}>
        <Avatar name={m.from.name || m.from.address} email={m.from.address} size={28} />
        <span className="msg-card-from">{m.from.name || m.from.address}</span>
        <span className="grow ellipsis muted">{m.snippet}</span>
        <span className="muted small-text">{longDate(m.date)}</span>
      </div>
    );
  }
  return (
    <div className="msg-card">
      <div className="msg-card-head">
        <Avatar name={m.from.name || m.from.address} email={m.from.address} size={40} />
        <div className="grow" style={{ minWidth: 0 }} onClick={onToggle}>
          <div className="row" style={{ gap: 6 }}>
            <span className="msg-card-from ellipsis">{m.from.name || m.from.address}</span>
            {m.from.name && <span className="muted small-text ellipsis selectable">&lt;{m.from.address}&gt;</span>}
          </div>
          <Recipients label="An" list={m.to} />
          <Recipients label="Cc" list={m.cc} />
          {body && <Recipients label="Bcc" list={body.bcc} />}
        </div>
        <div className="msg-card-actions">
          <span className="muted small-text msg-card-date">{longDate(m.date)}</span>
          <div className="row" style={{ gap: 0 }}>
            <IconButton label="Antworten" onClick={() => void A.reply('reply', m)}>
              <Reply size={17} />
            </IconButton>
            <IconButton label="Allen antworten" onClick={() => void A.reply('replyAll', m)}>
              <ReplyAll size={17} />
            </IconButton>
            <IconButton label="Weiterleiten" onClick={() => void A.reply('forward', m)}>
              <Forward size={17} />
            </IconButton>
            <Menu
              align="end"
              trigger={
                <IconButton label="Weitere Aktionen">
                  <MoreHorizontal size={17} />
                </IconButton>
              }
              items={messageMenu(m)}
            />
          </div>
        </div>
      </div>
      {(m.categories.length > 0 || (m.flagged && m.dueAt)) && (
        <div className="row msg-card-meta">
          {m.flagged && m.dueAt && (
            <span className="chip" style={{ color: 'var(--flag)' }}>
              <Flag size={12} /> Fällig {longDate(m.dueAt)}
            </span>
          )}
          {m.categories.map((c) => (
            <span key={c} className="chip" style={{ background: categories.find((x) => x.name === c)?.color ?? '#888', color: '#fff' }}>
              {c}
            </span>
          ))}
        </div>
      )}
      {loading && (
        <div className="row muted" style={{ padding: 16 }}>
          <Spinner /> Nachricht wird geladen …
        </div>
      )}
      {error && <div className="banner error">Die Nachricht konnte nicht geladen werden: {error}</div>}
      {body && (
        <>
          {body.invite && <InviteCard m={m} events={body.invite} />}
          {body.hasRemoteContent && !allowed && (
            <div className="banner">
              <ImageOff size={16} />
              <span className="grow">Externe Bilder wurden zum Schutz Ihrer Privatsphäre blockiert.</span>
              <Button small variant="subtle" onClick={allowOnce}>
                Bilder laden
              </Button>
              <Button
                small
                variant="subtle"
                onClick={() => {
                  const s = useApp.getState().settings!;
                  void useApp.getState().updateSettings({ safeSenders: [...s.safeSenders, m.from.address.toLowerCase()] });
                  allowOnce();
                }}
              >
                Absender immer vertrauen
              </Button>
            </div>
          )}
          {body.listUnsubscribe && (
            <div className="banner subtle">
              <MailX size={16} />
              <span className="grow">Newsletter von {m.from.name || m.from.address}</span>
              <Button small variant="subtle" onClick={() => void A.unsubscribe([m])}>
                Abo kündigen
              </Button>
            </div>
          )}
          <Attachments m={m} list={body.attachments} />
          <div className={clsx('msg-body', standalone && 'standalone')}>
            <BodyFrame html={body.html ?? ''} allowRemote={allowed} plain={!body.html} />
          </div>
        </>
      )}
    </div>
  );
}

function useMarkRead(m: MessageHeader | null): void {
  const after = useApp((s) => s.settings?.mail.markReadAfter ?? 2);
  useEffect(() => {
    if (!m || m.seen || after < 0) return;
    const t = setTimeout(() => void A.setRead(true, [m]), after * 1000);
    return () => clearTimeout(t);
  }, [m?.id, m?.seen, after]);
}

export function MessageView({ m, standalone }: { m: MessageHeader; standalone?: boolean }): JSX.Element {
  const conversations = useApp((s) => s.settings?.mail.conversationView ?? false);
  const [thread, setThread] = useState<MessageHeader[]>([m]);
  const [open, setOpen] = useState<Set<number>>(new Set([m.id]));
  useMarkRead(m);
  useEffect(() => {
    setOpen(new Set([m.id]));
    if (!conversations) {
      setThread([m]);
      return;
    }
    void api.mail.thread(m.id).then((t) => setThread(t.length ? t : [m]));
  }, [m.id, conversations]);
  const list = conversations ? thread : [m];
  return (
    <div className="reading-scroll">
      <div className="reading-subject">
        <h2 className="selectable">{m.subject || '(Ohne Betreff)'}</h2>
        {list.length > 1 && <span className="chip">{list.length} Nachrichten</span>}
        {!standalone && (
          <IconButton label="In neuem Fenster öffnen" onClick={() => void A.openInWindow([m])}>
            <ExternalLink size={16} />
          </IconButton>
        )}
      </div>
      {list.map((x) => (
        <MessageCard
          key={x.id}
          m={x.id === m.id ? m : x}
          standalone={standalone}
          expanded={open.has(x.id) || list.length === 1}
          onToggle={
            list.length > 1
              ? () => {
                  const n = new Set(open);
                  if (n.has(x.id)) n.delete(x.id);
                  else n.add(x.id);
                  setOpen(n);
                }
              : undefined
          }
        />
      ))}
      {list.length > 1 && (
        <div className="row" style={{ justifyContent: 'center', padding: 8 }}>
          <Button small variant="subtle" icon={<ChevronDown size={14} />} onClick={() => setOpen(new Set(list.map((x) => x.id)))}>
            Alle aufklappen
          </Button>
          <Button small variant="subtle" icon={<ChevronUp size={14} />} onClick={() => setOpen(new Set([m.id]))}>
            Zuklappen
          </Button>
        </div>
      )}
    </div>
  );
}

export function ReadingPane(): JSX.Element {
  const focusedId = useMail((s) => s.focusedId);
  const selectedCount = useMail((s) => s.selected.length);
  const items = useMail((s) => s.serverResults ?? s.items);
  const m = items.find((x) => x.id === focusedId) ?? null;

  if (selectedCount > 1) {
    const sel = selectedMessages();
    return (
      <div className="pane reading-pane">
        <Empty icon={<Mail size={48} />} title={`${selectedCount} Nachrichten ausgewählt`}>
          <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
            <Button icon={<Mail size={15} />} onClick={() => void A.setRead(!sel.every((x) => x.seen), sel)}>
              {sel.every((x) => x.seen) ? 'Als ungelesen markieren' : 'Als gelesen markieren'}
            </Button>
            <Button icon={<Flag size={15} />} onClick={() => void A.toggleFlag(sel)}>
              Kennzeichnen
            </Button>
            <Button icon={<FolderInput size={15} />} onClick={() => void A.moveTo(undefined, sel)}>
              Verschieben
            </Button>
            <Button icon={<Archive size={15} />} onClick={() => void A.archive(sel)}>
              Archivieren
            </Button>
            <Button icon={<Trash2 size={15} />} onClick={() => void A.remove(false, sel)}>
              Löschen
            </Button>
          </div>
        </Empty>
      </div>
    );
  }
  if (!m) {
    return (
      <div className="pane reading-pane">
        <Empty icon={<Mail size={48} strokeWidth={1.2} />} title="Wählen Sie ein Element zum Lesen aus">
          Nichts ausgewählt
        </Empty>
      </div>
    );
  }
  if (m.draft) {
    return (
      <div className="pane reading-pane">
        <div className="banner" style={{ margin: 16 }}>
          <span className="grow">Dies ist ein Entwurf.</span>
          <Button small variant="primary" onClick={() => void A.openDraft(m)}>
            Entwurf bearbeiten
          </Button>
        </div>
        <MessageView m={m} />
      </div>
    );
  }
  return (
    <div className="pane reading-pane">
      <MessageView m={m} />
    </div>
  );
}
