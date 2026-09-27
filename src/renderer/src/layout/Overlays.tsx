// Global overlays: toasts, prompt/confirm dialogs, command palette, folder picker, shortcut help, outbox, source, snooze.

import clsx from 'clsx';
import { CalendarDays, CheckSquare, Clock, Mail, Search, User, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { COMMANDS } from '@shared/commands';
import type { OutboxItem, SearchHit } from '@shared/types';
import { api, errorMessage } from '../api/client';
import { hasCommand, runCommand, shortcutFor } from '../lib/commands';
import { formatKeys } from '../lib/keys';
import { addDays, listDate, longDate, startOfDay, fromInputDateTime, toInputDateTime } from '../lib/format';
import { attempt, useApp } from '../store/app';
import { Button, Dialog, Spinner } from '../components/ui';
import { folderIcon, folderLabel } from '../mail/folders';

function Toasts(): JSX.Element {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={clsx('toast', t.kind)} role="status">
          <span className="grow">{t.text}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="toast-action" onClick={() => dismiss(t.id)} aria-label="Schließen">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function PromptDialog(): JSX.Element | null {
  const p = useApp((s) => s.prompt);
  const [value, setValue] = useState('');
  useEffect(() => setValue(p?.value ?? ''), [p]);
  if (!p) return null;
  const close = (v: string | null): void => {
    useApp.setState({ prompt: null });
    p.resolve(v);
  };
  return (
    <Dialog
      open
      onClose={() => close(null)}
      title={p.title}
      width={440}
      footer={
        <>
          <Button onClick={() => close(null)}>Abbrechen</Button>
          <Button variant="primary" onClick={() => close(value)} disabled={!value.trim()}>
            {p.okLabel ?? 'OK'}
          </Button>
        </>
      }
    >
      <div className="field">
        {p.label && <label>{p.label}</label>}
        <input
          className="input"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) close(value);
          }}
        />
      </div>
    </Dialog>
  );
}

function ConfirmDialog(): JSX.Element | null {
  const c = useApp((s) => s.confirm);
  if (!c) return null;
  const close = (ok: boolean): void => {
    useApp.setState({ confirm: null });
    c.resolve(ok);
  };
  return (
    <Dialog
      open
      onClose={() => close(false)}
      title={c.title}
      width={440}
      footer={
        <>
          <Button onClick={() => close(false)}>Abbrechen</Button>
          <Button variant={c.danger ? 'danger' : 'primary'} autoFocus onClick={() => close(true)}>
            {c.okLabel ?? 'OK'}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0, lineHeight: 1.5 }}>{c.text}</p>
    </Dialog>
  );
}

interface PaletteItem {
  key: string;
  icon: JSX.Element;
  title: string;
  hint: string;
  run: () => void;
}

const HIT_ICON = { mail: Mail, event: CalendarDays, contact: User, task: CheckSquare };

function Palette({ mode }: { mode?: 'commands' | 'search' }): JSX.Element {
  const close = (): void => useApp.getState().setOverlay(null);
  const [q, setQ] = useState(mode === 'search' ? '' : '');
  const [idx, setIdx] = useState(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const folders = useApp((s) => s.folders);
  const accounts = useApp((s) => s.accounts);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      void api.app
        .search(text)
        .then(setHits)
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const items = useMemo<PaletteItem[]>(() => {
    const text = q.toLowerCase().trim();
    const words = text.split(/\s+/).filter(Boolean);
    const match = (s: string): boolean => words.every((w) => s.toLowerCase().includes(w));
    const out: PaletteItem[] = [];
    for (const c of COMMANDS) {
      if (!hasCommand(c.id)) continue;
      if (words.length && !match(`${c.label} ${c.group}`)) continue;
      out.push({ key: c.id, icon: <span className="palette-group">{c.group}</span>, title: c.label, hint: formatKeys(shortcutFor(c.id)), run: () => void runCommand(c.id) });
    }
    if (words.length) {
      for (const f of folders.filter((f) => f.selectable && match(folderLabel(f)))) {
        const acc = accounts.find((a) => a.id === f.accountId);
        const Icon = folderIcon(f);
        out.push({
          key: 'f:' + f.id,
          icon: <Icon size={16} />,
          title: `Gehe zu: ${folderLabel(f)}`,
          hint: acc?.name ?? '',
          run: () => void runCommand('open.folder', f.id)
        });
      }
      for (const h of hits) {
        const Icon = HIT_ICON[h.kind];
        out.push({
          key: `${h.kind}:${h.id}`,
          icon: <Icon size={16} />,
          title: h.title,
          hint: [h.subtitle, h.date ? listDate(h.date) : ''].filter(Boolean).join(' · '),
          run: () => void runCommand(`open.${h.kind === 'mail' ? 'message' : h.kind}`, h.id)
        });
      }
    }
    return out.slice(0, 200);
  }, [q, folders, accounts, hits]);

  useEffect(() => setIdx(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  const pick = (i: number): void => {
    const it = items[i];
    if (!it) return;
    close();
    it.run();
  };

  return (
    <div className="palette-backdrop" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Search size={18} />
          <input
            autoFocus
            value={q}
            placeholder="Befehl, Ordner, E-Mail, Termin, Kontakt oder Aufgabe suchen …"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIdx((i) => Math.min(items.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIdx((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') pick(idx);
            }}
          />
          {searching && <Spinner />}
        </div>
        <div className="palette-list" ref={listRef}>
          {items.map((it, i) => (
            <div key={it.key} className={clsx('palette-item', i === idx && 'active')} onMouseEnter={() => setIdx(i)} onClick={() => pick(i)}>
              <span className="palette-icon">{it.icon}</span>
              <span className="grow ellipsis">{it.title}</span>
              {it.hint && <span className="palette-hint">{it.hint}</span>}
            </div>
          ))}
          {!items.length && <div className="palette-empty">Keine Treffer</div>}
        </div>
      </div>
    </div>
  );
}

function FolderPicker({ title, resolve, accountId }: { title: string; resolve: (id: string | null) => void; accountId?: string }): JSX.Element {
  const folders = useApp((s) => s.folders);
  const accounts = useApp((s) => s.accounts);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const list = folders
    .filter((f) => f.selectable && (!accountId || f.accountId === accountId) && folderLabel(f).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.accountId.localeCompare(b.accountId) || (a.specialUse === 'inbox' ? -1 : b.specialUse === 'inbox' ? 1 : a.path.localeCompare(b.path)));
  const done = (id: string | null): void => {
    useApp.getState().setOverlay(null);
    resolve(id);
  };
  return (
    <Dialog open onClose={() => done(null)} title={title} width={460}>
      <input
        className="input"
        style={{ width: '100%' }}
        autoFocus
        placeholder="Ordner suchen …"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setIdx(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setIdx((i) => Math.min(list.length - 1, i + 1));
          if (e.key === 'ArrowUp') setIdx((i) => Math.max(0, i - 1));
          if (e.key === 'Enter' && list[idx]) done(list[idx].id);
        }}
      />
      <div className="picker-list">
        {list.map((f, i) => {
          const Icon = folderIcon(f);
          const depth = f.path.split(f.delimiter).length - 1;
          return (
            <div key={f.id} className={clsx('picker-item', i === idx && 'active')} style={{ paddingLeft: 10 + depth * 16 }} onMouseEnter={() => setIdx(i)} onClick={() => done(f.id)}>
              <Icon size={16} />
              <span className="grow ellipsis">{folderLabel(f)}</span>
              {accounts.length > 1 && <span className="muted small-text">{accounts.find((a) => a.id === f.accountId)?.name}</span>}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

function ShortcutHelp(): JSX.Element {
  const groups = new Map<string, typeof COMMANDS>();
  for (const c of COMMANDS) {
    const k = shortcutFor(c.id);
    if (!k) continue;
    groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  }
  return (
    <Dialog open onClose={() => useApp.getState().setOverlay(null)} title="Tastenkombinationen" width={760} height="80vh">
      <div className="shortcut-grid">
        {[...groups].map(([g, list]) => (
          <section key={g}>
            <h4>{g}</h4>
            {list.map((c) => (
              <div key={c.id} className="shortcut-row">
                <span className="grow">{c.label}</span>
                <span className="kbd">{formatKeys(shortcutFor(c.id))}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
      <p className="muted small-text">Alle Tastenkombinationen lassen sich unter Einstellungen → Tastenkombinationen ändern.</p>
    </Dialog>
  );
}

function OutboxDialog(): JSX.Element {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const accounts = useApp((s) => s.accounts);
  const load = (): void => void api.compose.outbox().then(setItems);
  useEffect(() => {
    load();
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <Dialog open onClose={() => useApp.getState().setOverlay(null)} title="Postausgang" width={640}>
      {!items.length && <p className="muted">Der Postausgang ist leer.</p>}
      <div className="col">
        {items.map((it) => (
          <div key={it.id} className="outbox-row">
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="ellipsis" style={{ fontWeight: 600 }}>{it.subject || '(Ohne Betreff)'}</div>
              <div className="muted small-text ellipsis">
                An {it.to} · {accounts.find((a) => a.id === it.accountId)?.name} ·{' '}
                {it.status === 'failed' ? <span style={{ color: 'var(--danger)' }}>Fehler: {it.error}</span> : it.status === 'sending' ? 'Wird gesendet …' : `Senden ${longDate(it.sendAt)}`}
              </div>
            </div>
            {it.status === 'failed' && (
              <Button small onClick={() => void attempt(() => api.compose.retryOutbox(it.id))}>
                Erneut senden
              </Button>
            )}
            {it.status !== 'sending' && (
              <Button
                small
                onClick={async () => {
                  const d = await attempt(() => api.compose.cancelOutbox(it.id));
                  if (d) {
                    useApp.getState().setOverlay(null);
                    useApp.getState().openComposer(d);
                  }
                }}
              >
                Bearbeiten
              </Button>
            )}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

function SourceDialog({ messageId }: { messageId: number }): JSX.Element {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    api.mail
      .source(messageId)
      .then(setSrc)
      .catch((e) => setSrc(errorMessage(e)));
  }, [messageId]);
  return (
    <Dialog open onClose={() => useApp.getState().setOverlay(null)} title="Nachrichtenquelltext" width="80vw" height="80vh">
      {src === null ? <Spinner /> : <pre className="source-view selectable">{src}</pre>}
    </Dialog>
  );
}

export function snoozeOptions(): { label: string; at: number }[] {
  const now = new Date();
  const at = (days: number, h: number): number => {
    const d = new Date(startOfDay(addDays(Date.now(), days)));
    d.setHours(h, 0, 0, 0);
    return d.getTime();
  };
  const nextMonday = at((8 - now.getDay()) % 7 || 7, 8);
  const opts = [
    { label: 'In 1 Stunde', at: Date.now() + 3600_000 },
    { label: 'In 3 Stunden', at: Date.now() + 3 * 3600_000 },
    { label: 'Heute Abend (18:00)', at: at(0, 18) },
    { label: 'Morgen früh (08:00)', at: at(1, 8) },
    { label: 'Wochenende (Sa 09:00)', at: at((6 - now.getDay() + 7) % 7 || 7, 9) },
    { label: 'Nächste Woche (Mo 08:00)', at: nextMonday }
  ];
  return opts.filter((o) => o.at > Date.now());
}

function SnoozeDialog({ ids }: { ids: number[] }): JSX.Element {
  const [custom, setCustom] = useState(toInputDateTime(addDays(Date.now(), 1)));
  const done = async (at: number): Promise<void> => {
    useApp.getState().setOverlay(null);
    await attempt(() => api.mail.snooze(ids, at), `Zurückgestellt bis ${longDate(at)}`);
  };
  return (
    <Dialog open onClose={() => useApp.getState().setOverlay(null)} title="Zurückstellen" width={380}>
      <div className="col">
        {snoozeOptions().map((o) => (
          <button key={o.label} className="picker-item" onClick={() => void done(o.at)}>
            <Clock size={16} />
            <span className="grow">{o.label}</span>
            <span className="muted small-text">{longDate(o.at)}</span>
          </button>
        ))}
        <div className="row" style={{ marginTop: 8 }}>
          <input type="datetime-local" className="input grow" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <Button variant="primary" onClick={() => void done(fromInputDateTime(custom))}>
            OK
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function Overlays(): JSX.Element {
  const overlay = useApp((s) => s.overlay);
  return (
    <>
      <Toasts />
      <PromptDialog />
      <ConfirmDialog />
      {overlay?.kind === 'palette' && <Palette mode={overlay.mode} />}
      {overlay?.kind === 'folderPicker' && <FolderPicker title={overlay.title} resolve={overlay.resolve} accountId={overlay.accountId} />}
      {overlay?.kind === 'shortcuts' && <ShortcutHelp />}
      {overlay?.kind === 'outbox' && <OutboxDialog />}
      {overlay?.kind === 'source' && <SourceDialog messageId={overlay.messageId} />}
      {overlay?.kind === 'snooze' && <SnoozeDialog ids={overlay.ids} />}
    </>
  );
}

