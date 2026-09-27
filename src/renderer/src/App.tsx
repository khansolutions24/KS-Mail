// Root component: loads state, wires backend events and global commands, renders the shell or a standalone window.

import { useEffect, useState } from 'react';
import { VIRTUAL } from '@shared/types';
import { api, isElectron, onEvent } from './api/client';
import { installKeyboard, registerCommands, runCommand } from './lib/commands';
import { applyTheme } from './lib/theme';
import { attempt, confirm, pickFolder, useApp } from './store/app';
import { useMail } from './store/mail';
import { AppBar, TitleBar } from './layout/Shell';
import { Overlays } from './layout/Overlays';
import { MailView } from './mail/MailView';
import { MessageWindow } from './mail/MessageWindow';
import { ComposeWindow } from './mail/ComposeWindow';
import { draftFromMailto, newDraft } from './mail/compose';
import { CalendarView } from './calendar/CalendarView';
import { ContactsView } from './contacts/ContactsView';
import { TasksView } from './tasks/TasksView';
import { NotesView } from './notes/NotesView';
import { SettingsView } from './settings/SettingsView';
import { setIntent } from './store/intent';

function useRoute(): string {
  const [hash, setHash] = useState(location.hash.replace(/^#/, ''));
  useEffect(() => {
    const h = (): void => setHash(location.hash.replace(/^#/, ''));
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return hash;
}

function useBootstrap(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const s = useApp.getState();
    void Promise.all([s.loadSettings(), s.loadAccounts(), s.loadFolders(), api.mail.syncState().then((l) => l.forEach((x) => useApp.getState().setSync(x))), api.compose.outbox().then((o) => useApp.setState({ outboxCount: o.length }))])
      .catch(() => undefined)
      .finally(() => setReady(true));

    let mailTimer: number | undefined;
    const offs = [
      onEvent('settings:changed', (settings) => useApp.setState({ settings })),
      onEvent('accounts:changed', () => {
        void useApp.getState().loadAccounts();
        void useMail.getState().load();
      }),
      onEvent('folders:changed', () => void useApp.getState().loadFolders()),
      onEvent('sync:state', (st) => useApp.getState().setSync(st)),
      onEvent('toast', (t) => useApp.getState().toast(t.kind, t.text)),
      onEvent('outbox:changed', () => void api.compose.outbox().then((o) => useApp.setState({ outboxCount: o.length }))),
      onEvent('mail:changed', () => {
        // coalesce bursts of changes
        window.clearTimeout(mailTimer);
        mailTimer = window.setTimeout(() => {
          void useMail.getState().load();
          void useApp.getState().loadFolders();
        }, 120);
      }),
      onEvent('command', (c) => void runCommand(c.command, c.arg))
    ];
    return () => offs.forEach((o) => o());
  }, []);
  return ready;
}

function useTheme(): void {
  const settings = useApp((s) => s.settings);
  useEffect(() => {
    applyTheme(settings);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const h = (): void => applyTheme(useApp.getState().settings);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [settings]);
}

function useGlobalCommands(): void {
  useEffect(() => {
    const app = useApp.getState;
    const mailSettings = (patch: Record<string, unknown>): Promise<void> => app().updateSettings({ mail: { ...app().settings!.mail, ...patch } });
    const go = (m: Parameters<ReturnType<typeof app>['setModule']>[0]) => () => app().setModule(m);
    const offKeys = installKeyboard();
    const off = registerCommands({
      'nav.mail': go('mail'),
      'nav.calendar': go('calendar'),
      'nav.contacts': go('contacts'),
      'nav.tasks': go('tasks'),
      'nav.notes': go('notes'),
      'nav.settings': () => app().openSettings(),
      'nav.palette': () => app().setOverlay({ kind: 'palette' }),
      'nav.search': () => {
        if (app().module === 'mail' || app().module === 'contacts') window.dispatchEvent(new Event('ksmail:focus-search'));
        else app().setOverlay({ kind: 'palette', mode: 'search' });
      },
      'nav.inbox': () => {
        app().setModule('mail');
        useMail.getState().setFolder(VIRTUAL.unifiedInbox);
      },
      'nav.goToFolder': async () => {
        const id = await pickFolder('Gehe zu Ordner');
        if (id) await runCommand('open.folder', id);
      },
      'nav.shortcuts': () => app().setOverlay({ kind: 'shortcuts' }),
      'open.folder': (id) => {
        if (!id) return;
        app().setModule('mail');
        app().setActiveComposer(null);
        useMail.getState().setFolder(id);
      },
      'open.message': async (id) => {
        const m = id ? await api.mail.get(Number(id)) : null;
        if (!m) return;
        app().setModule('mail');
        app().setActiveComposer(null);
        const mail = useMail.getState();
        if (mail.folderId !== m.folderId && !(mail.folderId === VIRTUAL.unifiedInbox && app().folders.find((f) => f.id === m.folderId)?.specialUse === 'inbox')) {
          mail.setFolder(m.folderId);
        }
        await useMail.getState().load();
        useMail.getState().select(m.id);
      },
      'open.event': (id) => setIntent('calendar', 'openEvent', id),
      'open.contact': (id) => setIntent('contacts', 'openContact', id),
      'open.task': (id) => setIntent('tasks', 'openTask', id),
      'mail.new': () => app().openComposer(newDraft()),
      mailto: (url) => {
        if (url) app().openComposer(draftFromMailto(url));
      },
      'calendar.newEvent': () => setIntent('calendar', 'newEvent'),
      'contacts.new': () => setIntent('contacts', 'newContact'),
      'tasks.new': () => setIntent('tasks', 'newTask'),
      'notes.new': () => setIntent('notes', 'newNote'),
      'mail.sync': () => attempt(() => api.mail.sync()),
      'mail.outbox': () => app().setOverlay({ kind: 'outbox' }),
      'view.readingRight': () => mailSettings({ readingPane: 'right' }),
      'view.readingBottom': () => mailSettings({ readingPane: 'bottom' }),
      'view.readingOff': () => mailSettings({ readingPane: 'off' }),
      'view.toggleFolders': () => app().toggleFolders(),
      'view.toggleConversations': () => mailSettings({ conversationView: !app().settings?.mail.conversationView }),
      'view.themeLight': () => app().updateSettings({ theme: 'light' }),
      'view.themeDark': () => app().updateSettings({ theme: 'dark' }),
      'view.themeSystem': () => app().updateSettings({ theme: 'system' }),
      'view.densityCompact': () => app().updateSettings({ density: 'compact' }),
      'view.densityComfortable': () => app().updateSettings({ density: 'comfortable' }),
      'view.zoomIn': () => app().updateSettings({ fontSize: Math.min(20, (app().settings?.fontSize ?? 14) + 1) }),
      'view.zoomOut': () => app().updateSettings({ fontSize: Math.max(11, (app().settings?.fontSize ?? 14) - 1) }),
      'view.zoomReset': () => app().updateSettings({ fontSize: 14 }),
      'account.add': () => {
        app().openSettings('accounts');
        setIntent('settings', 'newAccount');
      },
      'account.addDemo': () => attempt(() => api.accounts.addDemo(), 'Demo-Konto hinzugefügt'),
      'settings.accounts': () => app().openSettings('accounts'),
      'settings.rules': () => app().openSettings('rules'),
      'settings.signatures': () => app().openSettings('signatures'),
      'settings.categories': () => app().openSettings('categories'),
      'settings.quickSteps': () => app().openSettings('quicksteps'),
      'settings.templates': () => app().openSettings('templates'),
      'settings.outOfOffice': () => app().openSettings('ooo'),
      'settings.shortcuts': () => app().openSettings('shortcuts'),
      'settings.export': async () => {
        const p = await attempt(() => api.settings.exportAll());
        if (p) app().toast('success', `Exportiert nach ${p}`);
      },
      'settings.import': async () => {
        if (await confirm('Daten importieren', 'Einstellungen werden überschrieben; Kalender, Kontakte, Aufgaben und Notizen werden zusammengeführt. Fortfahren?', 'Importieren')) {
          await attempt(() => api.settings.importAll());
        }
      },
      'app.dataDir': () => attempt(() => api.app.openDataDir()),
      'app.clearCache': async () => {
        if (await confirm('Cache leeren', 'Heruntergeladene Nachrichteninhalte werden gelöscht und bei Bedarf neu geladen.', 'Leeren')) await attempt(() => api.app.clearCache());
      },
      'app.newWindow': () => (isElectron ? attempt(() => api.app.newWindow('')) : window.open(location.href)),
      'app.reload': () => location.reload(),
      'app.quit': () => attempt(() => api.app.quit())
    });
    return () => {
      off();
      offKeys();
    };
  }, []);
}

function Main(): JSX.Element {
  const module = useApp((s) => s.module);
  return (
    <div className="app">
      <TitleBar />
      <div className="app-body">
        <AppBar />
        <main className="module">
          {module === 'mail' && <MailView />}
          {module === 'calendar' && <CalendarView />}
          {module === 'contacts' && <ContactsView />}
          {module === 'tasks' && <TasksView />}
          {module === 'notes' && <NotesView />}
          {module === 'settings' && <SettingsView />}
        </main>
      </div>
    </div>
  );
}

export function App(): JSX.Element | null {
  const ready = useBootstrap();
  const route = useRoute();
  useTheme();
  useGlobalCommands();
  if (!ready) return null;
  const msg = /^\/message\/(\d+)/.exec(route);
  const compose = /^\/compose\/(.+)/.exec(route);
  return (
    <>
      {msg ? <MessageWindow id={Number(msg[1])} /> : compose ? <ComposeWindow draftId={decodeURIComponent(compose[1])} /> : <Main />}
      <Overlays />
    </>
  );
}
