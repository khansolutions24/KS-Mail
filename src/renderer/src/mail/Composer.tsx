// Mail composer: recipients with autocomplete, rich text editor, attachments, send / send later / undo send, drafts.

import clsx from 'clsx';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Clock,
  ExternalLink,
  FileSignature,
  Highlighter,
  Image as ImageIcon,
  Indent,
  Italic,
  Link,
  List,
  ListOrdered,
  Outdent,
  Paperclip,
  Palette,
  RemoveFormatting,
  Save,
  Send,
  Strikethrough,
  Trash2,
  Underline,
  X,
  AlertTriangle,
  ArrowDown,
  MailCheck,
  LayoutTemplate
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address, Draft, DraftAttachment } from '@shared/types';
import { escapeHtml, formatAddress, formatBytes, isValidEmail, newId, parseAddressList } from '@shared/util';
import { api, errorMessage, isElectron, pathForFile } from '../api/client';
import { Button, Dialog, IconButton, Menu } from '../components/ui';
import { registerCommands } from '../lib/commands';
import { addDays, fromInputDateTime, longDate, startOfDay, toInputDateTime } from '../lib/format';
import { attempt, confirm, prompt, toast, useApp } from '../store/app';
import { signatureHtml } from './compose';

// ─── recipients ───

function RecipientInput({ label, value, onChange, autoFocus }: { label: string; value: Address[]; onChange: (v: Address[]) => void; autoFocus?: boolean }): JSX.Element {
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<Address[]>([]);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = text.trim();
    if (t.length < 1) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      void api.compose
        .suggest(t)
        .then((s) => {
          const taken = new Set(value.map((v) => v.address.toLowerCase()));
          setSuggestions(s.filter((x) => !taken.has(x.address.toLowerCase())));
          setIdx(0);
        })
        .catch(() => setSuggestions([]));
    }, 120);
    return () => clearTimeout(timer);
  }, [text, value]);

  const commit = (raw: string): void => {
    const parsed = parseAddressList(raw).filter((a) => a.address);
    if (parsed.length) onChange([...value, ...parsed]);
    setText('');
    setSuggestions([]);
  };
  const pick = (a: Address): void => {
    onChange([...value, a]);
    setText('');
    setSuggestions([]);
    inputRef.current?.focus();
  };

  return (
    <div className="recipient-field" onClick={() => inputRef.current?.focus()}>
      <span className="compose-label">{label}</span>
      <div className="recipient-chips">
        {value.map((a, i) => (
          <span key={i} className={clsx('recipient-chip', !isValidEmail(a.address) && 'invalid')} title={formatAddress(a)}>
            {a.name || a.address}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onChange(value.filter((_, j) => j !== i));
              }}
              aria-label="Entfernen"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            setTimeout(() => {
              if (text.trim()) commit(text);
              setSuggestions([]);
            }, 150);
          }}
          onPaste={(e) => {
            const t = e.clipboardData.getData('text');
            if (/[,;\n]/.test(t)) {
              e.preventDefault();
              commit(t.replace(/\n/g, ','));
            }
          }}
          onKeyDown={(e) => {
            if (suggestions.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault();
              setIdx((i) => (e.key === 'ArrowDown' ? Math.min(suggestions.length - 1, i + 1) : Math.max(0, i - 1)));
            } else if ((e.key === 'Enter' || e.key === 'Tab') && suggestions.length && text.trim()) {
              e.preventDefault();
              pick(suggestions[idx]);
            } else if ((e.key === 'Enter' || e.key === ',' || e.key === ';') && text.trim()) {
              e.preventDefault();
              commit(text);
            } else if (e.key === 'Backspace' && !text && value.length) {
              onChange(value.slice(0, -1));
            } else if (e.key === 'Escape' && suggestions.length) {
              e.stopPropagation();
              setSuggestions([]);
            }
          }}
        />
      </div>
      {suggestions.length > 0 && (
        <div className="suggestions">
          {suggestions.map((s, i) => (
            <div
              key={s.address}
              className={clsx('suggestion', i === idx && 'active')}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
            >
              <span className="grow ellipsis">{s.name || s.address}</span>
              {s.name && <span className="muted small-text ellipsis">{s.address}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── editor toolbar ───

function exec(cmd: string, value?: string): void {
  document.execCommand(cmd, false, value);
}

const COLORS = ['#000000', '#424242', '#d13438', '#ca5010', '#c19c00', '#107c10', '#038387', '#0f6cbd', '#5c2e91', '#e3008c'];
const SIZES: [string, string][] = [
  ['Klein', '2'],
  ['Normal', '3'],
  ['Groß', '5'],
  ['Sehr groß', '6']
];

function Toolbar({ onAttach, onInsertImage, onSignature, onTemplate }: { onAttach: () => void; onInsertImage: () => void; onSignature: (id: string) => void; onTemplate: (id: string) => void }): JSX.Element {
  const settings = useApp((s) => s.settings);
  const keep = (e: React.MouseEvent): void => e.preventDefault(); // keep editor selection
  return (
    <div className="compose-toolbar" onMouseDown={keep}>
      <IconButton small label="Fett (Strg+B)" onClick={() => exec('bold')}>
        <Bold size={15} />
      </IconButton>
      <IconButton small label="Kursiv (Strg+I)" onClick={() => exec('italic')}>
        <Italic size={15} />
      </IconButton>
      <IconButton small label="Unterstrichen (Strg+U)" onClick={() => exec('underline')}>
        <Underline size={15} />
      </IconButton>
      <IconButton small label="Durchgestrichen" onClick={() => exec('strikeThrough')}>
        <Strikethrough size={15} />
      </IconButton>
      <Menu
        trigger={
          <button className="icon-btn small" title="Schriftgröße" onMouseDown={keep}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>A</span>
            <ChevronDown size={11} />
          </button>
        }
        items={SIZES.map(([label, v]) => ({ label, onSelect: () => exec('fontSize', v) }))}
      />
      <Menu
        trigger={
          <button className="icon-btn small" title="Schriftfarbe" onMouseDown={keep}>
            <Palette size={15} />
          </button>
        }
        items={COLORS.map((c) => ({ label: c, swatch: c, onSelect: () => exec('foreColor', c) }))}
      />
      <Menu
        trigger={
          <button className="icon-btn small" title="Hervorheben" onMouseDown={keep}>
            <Highlighter size={15} />
          </button>
        }
        items={[
          ['Gelb', '#fff100'],
          ['Grün', '#b5f5b5'],
          ['Türkis', '#a0f0f0'],
          ['Rosa', '#ffc0e8'],
          ['Keine', 'transparent']
        ].map(([l, c]) => ({ label: l, swatch: c, onSelect: () => exec('hiliteColor', c) }))}
      />
      <span className="ribbon-sep" />
      <IconButton small label="Aufzählung" onClick={() => exec('insertUnorderedList')}>
        <List size={15} />
      </IconButton>
      <IconButton small label="Nummerierung" onClick={() => exec('insertOrderedList')}>
        <ListOrdered size={15} />
      </IconButton>
      <IconButton small label="Einzug verkleinern" onClick={() => exec('outdent')}>
        <Outdent size={15} />
      </IconButton>
      <IconButton small label="Einzug vergrößern" onClick={() => exec('indent')}>
        <Indent size={15} />
      </IconButton>
      <IconButton small label="Linksbündig" onClick={() => exec('justifyLeft')}>
        <AlignLeft size={15} />
      </IconButton>
      <IconButton small label="Zentriert" onClick={() => exec('justifyCenter')}>
        <AlignCenter size={15} />
      </IconButton>
      <IconButton small label="Rechtsbündig" onClick={() => exec('justifyRight')}>
        <AlignRight size={15} />
      </IconButton>
      <span className="ribbon-sep" />
      <IconButton
        small
        label="Link einfügen (Strg+K)"
        onClick={async () => {
          const sel = window.getSelection();
          const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
          const url = await prompt('Link einfügen', 'https://', 'Adresse');
          if (!url) return;
          if (range) {
            sel?.removeAllRanges();
            sel?.addRange(range);
          }
          if (range && !range.collapsed) exec('createLink', url);
          else exec('insertHTML', `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
        }}
      >
        <Link size={15} />
      </IconButton>
      <IconButton small label="Bild einfügen" onClick={onInsertImage}>
        <ImageIcon size={15} />
      </IconButton>
      <IconButton small label="Formatierung entfernen" onClick={() => exec('removeFormat')}>
        <RemoveFormatting size={15} />
      </IconButton>
      <span className="ribbon-sep" />
      <IconButton small label="Datei anfügen" onClick={onAttach}>
        <Paperclip size={15} />
      </IconButton>
      <Menu
        trigger={
          <button className="icon-btn small" title="Signatur einfügen" onMouseDown={keep}>
            <FileSignature size={15} />
          </button>
        }
        items={[
          ...(settings?.signatures ?? []).map((s) => ({ label: s.name, onSelect: () => onSignature(s.id) })),
          ...(settings?.signatures.length ? [{ separator: true }] : []),
          { label: 'Signaturen verwalten …', onSelect: () => useApp.getState().openSettings('signatures') }
        ]}
      />
      <Menu
        trigger={
          <button className="icon-btn small" title="Vorlage einfügen" onMouseDown={keep}>
            <LayoutTemplate size={15} />
          </button>
        }
        items={[
          ...(settings?.templates ?? []).map((t) => ({ label: t.name, onSelect: () => onTemplate(t.id) })),
          ...(settings?.templates.length ? [{ separator: true }] : []),
          { label: 'Vorlagen verwalten …', onSelect: () => useApp.getState().openSettings('templates') }
        ]}
      />
    </div>
  );
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function fileToAttachment(f: File): Promise<DraftAttachment> {
  const p = pathForFile(f);
  if (p) return { id: newId(), filename: f.name, contentType: f.type || 'application/octet-stream', size: f.size, path: p };
  return { id: newId(), filename: f.name, contentType: f.type || 'application/octet-stream', size: f.size, dataBase64: await readAsBase64(f) };
}

function SendLaterDialog({ onClose, onPick }: { onClose: () => void; onPick: (at: number) => void }): JSX.Element {
  const tomorrow8 = new Date(startOfDay(addDays(Date.now(), 1)));
  tomorrow8.setHours(8);
  const [v, setV] = useState(toInputDateTime(tomorrow8.getTime()));
  const monday = new Date(startOfDay(addDays(Date.now(), ((8 - new Date().getDay()) % 7) || 7)));
  monday.setHours(8);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Senden planen"
      width={380}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={() => onPick(fromInputDateTime(v))}>
            Senden planen
          </Button>
        </>
      }
    >
      <div className="col">
        <button className="picker-item" onClick={() => onPick(tomorrow8.getTime())}>
          <Clock size={16} /> <span className="grow">Morgen früh</span> <span className="muted small-text">{longDate(tomorrow8.getTime())}</span>
        </button>
        <button className="picker-item" onClick={() => onPick(monday.getTime())}>
          <Clock size={16} /> <span className="grow">Montag früh</span> <span className="muted small-text">{longDate(monday.getTime())}</span>
        </button>
        <input type="datetime-local" className="input" value={v} onChange={(e) => setV(e.target.value)} />
        <p className="muted small-text" style={{ margin: 0 }}>
          KS Mail muss zum geplanten Zeitpunkt laufen (auch minimiert im Infobereich).
        </p>
      </div>
    </Dialog>
  );
}

// ─── composer ───

export function Composer({ draft: initial, onClose, standalone }: { draft: Draft; onClose: () => void; standalone?: boolean }): JSX.Element {
  const accounts = useApp((s) => s.accounts);
  const [d, setD] = useState<Draft>(initial);
  const [showCc, setShowCc] = useState(initial.cc.length > 0);
  const [showBcc, setShowBcc] = useState(initial.bcc.length > 0);
  const [sending, setSending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [laterOpen, setLaterOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef(d);
  const dirty = useRef(false);
  draftRef.current = d;

  // editor content is uncontrolled: set once; replies start typing at the top of the body
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = initial.html;
    if (initial.to.length && initial.subject) {
      el.focus();
      const range = document.createRange();
      const first = el.querySelector('p') ?? el;
      range.setStart(first, 0);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.id]);

  const update = useCallback((patch: Partial<Draft>) => {
    dirty.current = true;
    setD((prev) => {
      const next = { ...prev, ...patch };
      if (!standalone) useApp.getState().updateComposer(next);
      return next;
    });
  }, [standalone]);

  const current = useCallback((): Draft => ({ ...draftRef.current, html: editorRef.current?.innerHTML ?? draftRef.current.html }), []);

  // crash-safe local autosave
  useEffect(() => {
    const t = setInterval(() => {
      if (!dirty.current) return;
      void api.compose.saveLocalDraft(current()).catch(() => undefined);
    }, 3000);
    return () => clearInterval(t);
  }, [current]);

  const saveToServer = async (silent = false): Promise<void> => {
    const saved = await attempt(() => api.compose.saveDraft(current()));
    if (saved) {
      setD((prev) => ({ ...prev, serverDraftMessageId: saved.serverDraftMessageId, attachments: saved.attachments }));
      dirty.current = false;
      setSavedAt(Date.now());
      if (!silent) toast('success', 'Entwurf gespeichert');
    }
  };

  const close = async (): Promise<void> => {
    const cur = current();
    const text = (editorRef.current?.innerText ?? '').trim();
    if (dirty.current && (text || cur.subject || cur.to.length)) {
      await saveToServer(true);
      toast('info', 'Entwurf in „Entwürfe“ gespeichert');
    } else {
      void api.compose.removeLocalDraft(cur.id).catch(() => undefined);
    }
    onClose();
  };

  const discard = async (): Promise<void> => {
    if (dirty.current && !(await confirm('Verwerfen', 'Diese Nachricht verwerfen?', 'Verwerfen', true))) return;
    await attempt(() => api.compose.discardDraft(current()));
    onClose();
  };

  const send = async (sendAt?: number): Promise<void> => {
    const cur = { ...current(), sendAt: sendAt ?? null };
    if (!cur.to.length && !cur.cc.length && !cur.bcc.length) {
      toast('error', 'Bitte mindestens einen Empfänger angeben.');
      return;
    }
    const bad = [...cur.to, ...cur.cc, ...cur.bcc].find((a) => !isValidEmail(a.address));
    if (bad) {
      toast('error', `Ungültige Adresse: ${bad.address}`);
      return;
    }
    if (!cur.subject.trim() && !(await confirm('Kein Betreff', 'Diese Nachricht hat keinen Betreff. Trotzdem senden?', 'Senden'))) return;
    const text = (editorRef.current?.innerText ?? '').toLowerCase();
    if (/\b(anhang|anlage|angehängt|attached|attachment)\b/.test(text.split('von:')[0]) && !cur.attachments.length) {
      if (!(await confirm('Anlage vergessen?', 'Sie erwähnen eine Anlage, haben aber keine Datei angefügt. Trotzdem senden?', 'Senden'))) return;
    }
    setSending(true);
    try {
      const outboxId = await api.compose.send(cur);
      dirty.current = false;
      onClose();
      const undo = useApp.getState().settings?.mail.undoSendSeconds ?? 0;
      if (sendAt) toast('success', `Senden geplant: ${longDate(sendAt)}`, { label: 'Postausgang', run: () => useApp.getState().setOverlay({ kind: 'outbox' }) });
      else if (undo > 0) {
        toast('info', 'Wird gesendet …', {
          label: 'Rückgängig',
          run: async () => {
            const back = await api.compose.cancelOutbox(outboxId);
            if (back) useApp.getState().openComposer(back);
            else toast('error', 'Die Nachricht wurde bereits gesendet.');
          }
        });
      }
    } catch (err) {
      toast('error', errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const attachFiles = async (files: File[]): Promise<void> => {
    const list = await Promise.all(files.map(fileToAttachment));
    update({ attachments: [...draftRef.current.attachments, ...list] });
  };

  const pickAttachments = async (): Promise<void> => {
    if (isElectron) {
      const files = await attempt(() => api.compose.pickFiles());
      if (files?.length) update({ attachments: [...draftRef.current.attachments, ...files.map((f) => ({ id: newId(), ...f }))] });
    } else {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.onchange = () => void attachFiles(Array.from(input.files ?? []));
      input.click();
    }
  };

  const insertImage = (): void => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const data = await readAsBase64(f);
      editorRef.current?.focus();
      exec('insertHTML', `<img src="data:${f.type};base64,${data}" style="max-width:100%">`);
      dirty.current = true;
    };
    input.click();
  };

  const insertSignature = (id: string): void => {
    const sig = useApp.getState().settings?.signatures.find((s) => s.id === id);
    if (!sig || !editorRef.current) return;
    const existing = editorRef.current.querySelector('#ks-signature');
    if (existing) existing.innerHTML = `<br>${sig.html}`;
    else {
      editorRef.current.focus();
      exec('insertHTML', `<div id="ks-signature"><br>${sig.html}</div>`);
    }
    dirty.current = true;
  };

  const insertTemplate = (id: string): void => {
    const t = useApp.getState().settings?.templates.find((x) => x.id === id);
    if (!t) return;
    editorRef.current?.focus();
    exec('insertHTML', t.html);
    if (!draftRef.current.subject && t.subject) update({ subject: t.subject });
    dirty.current = true;
  };

  const changeAccount = (accountId: string): void => {
    // swap the signature for the new account's signature
    const el = editorRef.current;
    const sig = el?.querySelector('#ks-signature');
    const replacement = signatureHtml(accountId, d.mode === 'reply' || d.mode === 'replyAll' || d.mode === 'forward');
    if (sig && el) {
      if (replacement) sig.outerHTML = replacement;
      else sig.remove();
    }
    update({ accountId });
  };

  const popOut = async (): Promise<void> => {
    const cur = current();
    await attempt(() => api.compose.saveLocalDraft(cur));
    if (isElectron) await attempt(() => api.app.newWindow(`/compose/${encodeURIComponent(cur.id)}`));
    else window.open(`${location.pathname}#/compose/${encodeURIComponent(cur.id)}`, '_blank', 'width=900,height=760');
    onClose();
  };

  useEffect(
    () =>
      registerCommands({
        'compose.send': () => send(),
        'compose.save': () => saveToServer(),
        'compose.attach': () => pickAttachments(),
        'compose.discard': () => discard()
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const account = accounts.find((a) => a.id === d.accountId);
  const total = d.attachments.reduce((n, a) => n + a.size, 0);

  return (
    <div
      className={clsx('composer', standalone && 'standalone', dragOver && 'drag-over')}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={(e) => {
        setDragOver(false);
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        void attachFiles(Array.from(e.dataTransfer.files));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !standalone) {
          e.stopPropagation();
          void close();
        }
      }}
    >
      <div className="composer-actions">
        <div className="send-split">
          <Button variant="primary" icon={<Send size={15} />} disabled={sending || !accounts.length} onClick={() => void send()}>
            Senden
          </Button>
          <Menu
            trigger={
              <button className="btn primary send-split-arrow" disabled={sending} aria-label="Weitere Sendeoptionen">
                <ChevronDown size={14} />
              </button>
            }
            items={[{ label: 'Senden planen …', icon: <Clock size={15} />, onSelect: () => setLaterOpen(true) }]}
          />
        </div>
        <Button variant="subtle" icon={<Paperclip size={15} />} onClick={() => void pickAttachments()}>
          Anfügen
        </Button>
        <Menu
          trigger={
            <Button variant="subtle" icon={d.importance === 'high' ? <AlertTriangle size={15} color="var(--danger)" /> : d.importance === 'low' ? <ArrowDown size={15} /> : <AlertTriangle size={15} />}>
              Wichtigkeit
            </Button>
          }
          items={[
            { label: 'Hoch', checked: d.importance === 'high', onSelect: () => update({ importance: 'high' }) },
            { label: 'Normal', checked: !d.importance || d.importance === 'normal', onSelect: () => update({ importance: 'normal' }) },
            { label: 'Niedrig', checked: d.importance === 'low', onSelect: () => update({ importance: 'low' }) }
          ]}
        />
        <Button variant="subtle" icon={<MailCheck size={15} />} className={clsx(d.requestReadReceipt && 'toggled')} onClick={() => update({ requestReadReceipt: !d.requestReadReceipt })}>
          Lesebestätigung
        </Button>
        <div className="grow" />
        {savedAt && <span className="muted small-text">Gespeichert {new Date(savedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>}
        <IconButton label="Entwurf speichern" onClick={() => void saveToServer()}>
          <Save size={16} />
        </IconButton>
        {!standalone && (
          <IconButton label="In eigenem Fenster öffnen" onClick={() => void popOut()}>
            <ExternalLink size={16} />
          </IconButton>
        )}
        <IconButton label="Verwerfen" onClick={() => void discard()}>
          <Trash2 size={16} />
        </IconButton>
        <IconButton label="Schließen (als Entwurf speichern)" onClick={() => void close()}>
          <X size={17} />
        </IconButton>
      </div>
      <div className="composer-fields">
        {accounts.length > 1 && (
          <div className="recipient-field">
            <span className="compose-label">Von</span>
            <select className="compose-from" value={d.accountId} onChange={(e) => changeAccount(e.target.value)}>
              {accounts
                .filter((a) => a.enabled)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName || a.name} &lt;{a.email}&gt;
                  </option>
                ))}
            </select>
          </div>
        )}
        {accounts.length === 1 && account && (
          <div className="recipient-field">
            <span className="compose-label">Von</span>
            <span className="muted">{account.displayName || account.name} &lt;{account.email}&gt;</span>
          </div>
        )}
        <div className="recipient-row">
          <RecipientInput label="An" value={d.to} onChange={(to) => update({ to })} autoFocus={!initial.to.length} />
          <div className="cc-toggles">
            {!showCc && <button onClick={() => setShowCc(true)}>Cc</button>}
            {!showBcc && <button onClick={() => setShowBcc(true)}>Bcc</button>}
          </div>
        </div>
        {showCc && <RecipientInput label="Cc" value={d.cc} onChange={(cc) => update({ cc })} />}
        {showBcc && <RecipientInput label="Bcc" value={d.bcc} onChange={(bcc) => update({ bcc })} />}
        <div className="recipient-field">
          <input className="compose-subject" placeholder="Betreff hinzufügen" value={d.subject} onChange={(e) => update({ subject: e.target.value })} autoFocus={!!initial.to.length && !initial.subject} />
        </div>
      </div>
      {d.attachments.length > 0 && (
        <div className="attachments compose-attachments">
          {d.attachments.map((a) => (
            <div key={a.id} className="attachment">
              <span className="attachment-icon">
                <Paperclip size={16} />
              </span>
              <span className="attachment-name">
                <span className="ellipsis">{a.filename}</span>
                <span className="muted small-text">{formatBytes(a.size)}</span>
              </span>
              <IconButton small label="Entfernen" onClick={() => update({ attachments: d.attachments.filter((x) => x.id !== a.id) })}>
                <X size={14} />
              </IconButton>
            </div>
          ))}
          {total > 20 * 1024 * 1024 && <span className="small-text" style={{ color: 'var(--warning)' }}>Achtung: {formatBytes(total)} – viele Server erlauben max. 20–25 MB.</span>}
        </div>
      )}
      <Toolbar onAttach={() => void pickAttachments()} onInsertImage={insertImage} onSignature={insertSignature} onTemplate={insertTemplate} />
      <div
        ref={editorRef}
        className="composer-editor selectable"
        contentEditable
        suppressContentEditableWarning
        spellCheck
        onInput={() => {
          dirty.current = true;
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          const images = files.filter((f) => f.type.startsWith('image/'));
          if (images.length) {
            e.preventDefault();
            for (const img of images) void readAsBase64(img).then((data) => exec('insertHTML', `<img src="data:${img.type};base64,${data}" style="max-width:100%">`));
          } else if (files.length) {
            e.preventDefault();
            void attachFiles(files);
          }
        }}
        onKeyDown={(e) => {
          const mod = e.ctrlKey || e.metaKey;
          if (mod && e.key.toLowerCase() === 'k' && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            (document.querySelector('.compose-toolbar [title^="Link"]') as HTMLButtonElement | null)?.click();
          }
        }}
      />
      {dragOver && <div className="drop-hint">Dateien hier ablegen, um sie anzufügen</div>}
      {laterOpen && (
        <SendLaterDialog
          onClose={() => setLaterOpen(false)}
          onPick={(at) => {
            setLaterOpen(false);
            void send(at);
          }}
        />
      )}
    </div>
  );
}
