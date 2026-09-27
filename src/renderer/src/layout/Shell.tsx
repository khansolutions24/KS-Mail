// Window chrome: title bar with global search, module bar, status indicators.

import clsx from 'clsx';
import { AlertCircle, CalendarDays, CheckSquare, CloudOff, Mail, RefreshCw, Search, Settings as SettingsIcon, StickyNote, Users, Send, Command } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { isElectron, isMac } from '../api/client';
import { runCommand, shortcutFor } from '../lib/commands';
import { formatKeys } from '../lib/keys';
import { useApp, type Module } from '../store/app';
import { useMail } from '../store/mail';

const MODULES: { id: Module; label: string; icon: typeof Mail; cmd: string }[] = [
  { id: 'mail', label: 'E-Mail', icon: Mail, cmd: 'nav.mail' },
  { id: 'calendar', label: 'Kalender', icon: CalendarDays, cmd: 'nav.calendar' },
  { id: 'contacts', label: 'Kontakte', icon: Users, cmd: 'nav.contacts' },
  { id: 'tasks', label: 'Aufgaben', icon: CheckSquare, cmd: 'nav.tasks' },
  { id: 'notes', label: 'Notizen', icon: StickyNote, cmd: 'nav.notes' }
];

export function AppBar(): JSX.Element {
  const module = useApp((s) => s.module);
  const setModule = useApp((s) => s.setModule);
  const unread = useApp((s) => s.folders.filter((f) => f.specialUse === 'inbox').reduce((n, f) => n + f.unread, 0));
  return (
    <nav className="app-bar">
      {MODULES.map((m) => (
        <button key={m.id} className={clsx('app-bar-btn', module === m.id && 'active')} title={`${m.label} (${formatKeys(shortcutFor(m.cmd))})`} onClick={() => setModule(m.id)}>
          <m.icon size={22} strokeWidth={module === m.id ? 2 : 1.6} />
          <span className="app-bar-label">{m.label}</span>
          {m.id === 'mail' && unread > 0 && <span className="app-bar-badge">{unread > 999 ? '999+' : unread}</span>}
        </button>
      ))}
      <div className="grow" />
      <button className={clsx('app-bar-btn', module === 'settings' && 'active')} title={`Einstellungen (${formatKeys(shortcutFor('nav.settings'))})`} onClick={() => useApp.getState().openSettings()}>
        <SettingsIcon size={22} strokeWidth={module === 'settings' ? 2 : 1.6} />
      </button>
    </nav>
  );
}

function SyncIndicator(): JSX.Element | null {
  const sync = useApp((s) => s.sync);
  const accounts = useApp((s) => s.accounts);
  const outbox = useApp((s) => s.outboxCount);
  const states = Object.values(sync);
  const syncing = states.filter((s) => s.status === 'syncing');
  const errors = states.filter((s) => s.status === 'error' || s.status === 'offline');
  const name = (id: string): string => accounts.find((a) => a.id === id)?.name ?? '';
  return (
    <div className="titlebar-status">
      {outbox > 0 && (
        <button className="titlebar-chip" onClick={() => useApp.getState().setOverlay({ kind: 'outbox' })} title="Postausgang">
          <Send size={14} /> {outbox}
        </button>
      )}
      {errors.length > 0 && (
        <button className="titlebar-chip error" title={errors.map((e) => `${name(e.accountId)}: ${e.message}`).join('\n')} onClick={() => useApp.getState().openSettings('accounts')}>
          {errors.some((e) => e.status === 'offline') ? <CloudOff size={14} /> : <AlertCircle size={14} />}
          {errors.length === 1 ? name(errors[0].accountId) : `${errors.length} Konten`}
        </button>
      )}
      <button className={clsx('icon-btn small', syncing.length && 'spin')} title={syncing.length ? syncing.map((s) => `${name(s.accountId)}: ${s.message}`).join('\n') : `Senden/Empfangen (${formatKeys(shortcutFor('mail.sync'))})`} onClick={() => void runCommand('mail.sync')}>
        <RefreshCw size={15} />
      </button>
    </div>
  );
}

export function TitleBar(): JSX.Element {
  const module = useApp((s) => s.module);
  const search = useMail((s) => s.search);
  const [text, setText] = useState(search);
  const ref = useRef<HTMLInputElement>(null);
  const timer = useRef<number>();

  useEffect(() => setText(search), [search]);
  // other modules keep their own filter: start empty when switching
  useEffect(() => {
    setText(module === 'mail' ? useMail.getState().search : '');
  }, [module]);
  useEffect(() => {
    const focus = (): void => {
      ref.current?.focus();
      ref.current?.select();
    };
    window.addEventListener('ksmail:focus-search', focus);
    return () => window.removeEventListener('ksmail:focus-search', focus);
  }, []);

  const placeholder = module === 'mail' ? 'Suchen (z. B. von:anna betreff:bericht hat:anhang)' : module === 'contacts' ? 'Kontakte suchen' : 'Überall suchen';
  const onChange = (v: string): void => {
    setText(v);
    window.clearTimeout(timer.current);
    if (module === 'mail') timer.current = window.setTimeout(() => useMail.getState().setSearch(v), 250);
    else window.dispatchEvent(new CustomEvent('ksmail:search', { detail: v }));
  };
  return (
    <header className={clsx('titlebar', isMac && isElectron && 'mac', !isMac && isElectron && 'win')}>
      <div className="titlebar-brand">
        <Mail size={18} />
        <span>KS Mail</span>
      </div>
      <div className="titlebar-search">
        <Search size={16} className="titlebar-search-icon" />
        <input
          ref={ref}
          value={text}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onChange('');
              ref.current?.blur();
            }
            if (e.key === 'Enter' && module !== 'mail') useApp.getState().setOverlay({ kind: 'palette', mode: 'search' });
            if (e.key === 'ArrowDown' && module === 'mail') {
              e.preventDefault();
              document.querySelector<HTMLElement>('.message-list')?.focus();
            }
          }}
        />
        {text && (
          <button className="titlebar-search-clear" onClick={() => onChange('')} title="Suche löschen">
            ×
          </button>
        )}
      </div>
      <button className="titlebar-chip" onClick={() => useApp.getState().setOverlay({ kind: 'palette' })} title="Befehlspalette – alles per Tastatur steuern">
        <Command size={14} /> {formatKeys(shortcutFor('nav.palette'))}
      </button>
      <SyncIndicator />
    </header>
  );
}
