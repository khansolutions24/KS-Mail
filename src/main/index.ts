// Electron main process: windows, tray, native menu (macOS), notifications, mailto: links and IPC.

import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  safeStorage,
  shell,
  Tray,
  type MenuItemConstructorOptions
} from 'electron';
import { IPC_EVENT, IPC_INVOKE } from '@shared/api';
import pkg from '../../package.json';
import { createBackend, dispatch, type Backend } from '../backend/api';
import { emit, onEmit } from '../backend/events';
import { plainDecrypt, plainEncrypt, setPlatform } from '../backend/platform';

const isMac = process.platform === 'darwin';
const windows = new Set<BrowserWindow>();
let mainWin: BrowserWindow | null = null;
let backend: Backend | null = null;
let tray: Tray | null = null;
let quitting = false;
let pendingMailto: string | null = null;

// fixed name → data lives in %APPDATA%\KS Mail resp. ~/Library/Application Support/KS Mail, also when started unpackaged
app.setName('KS Mail');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.setAppUserModelId('de.ks.ksmail');
if (process.defaultApp) {
  if (process.argv.length >= 2) app.setAsDefaultProtocolClient('mailto', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('mailto');
}

function resource(name: string): string {
  return app.isPackaged ? path.join(process.resourcesPath, name) : path.join(__dirname, '../../build', name);
}

function handleMailto(url: string): void {
  if (!url.toLowerCase().startsWith('mailto:')) return;
  if (!mainWin) {
    pendingMailto = url;
    return;
  }
  showMain();
  emit('command', { command: 'mailto', arg: url });
}

function showMain(): void {
  if (!mainWin) {
    createWindow('');
    return;
  }
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

app.on('second-instance', (_e, argv) => {
  const mailto = argv.find((a) => a.toLowerCase().startsWith('mailto:'));
  if (mailto) handleMailto(mailto);
  else showMain();
});

app.on('open-url', (e, url) => {
  e.preventDefault();
  handleMailto(url);
});

function rendererUrl(route: string): { url?: string; file?: string; hash: string } {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  const hash = route ? route.replace(/^#?/, '') : '';
  if (!app.isPackaged && devUrl) return { url: devUrl + (hash ? '#' + hash : ''), hash };
  return { file: path.join(__dirname, '../renderer/index.html'), hash };
}

function createWindow(route: string): BrowserWindow {
  const isMain = !route;
  const win = new BrowserWindow({
    width: isMain ? 1440 : 980,
    height: isMain ? 900 : 760,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'KS Mail',
    icon: resource('icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1f1f' : '#f5f5f5',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
    titleBarOverlay: !isMac ? { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#242424', height: 40 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      webviewTag: false
    }
  });
  windows.add(win);
  if (isMain) mainWin = win;

  win.once('ready-to-show', () => {
    const s = backend?.config.getSettings();
    const hidden = isMain && !!s?.startMinimized;
    if (isMain && !hidden) win.maximize();
    if (!hidden) win.show();
    if (isMain && pendingMailto) {
      const m = pendingMailto;
      pendingMailto = null;
      setTimeout(() => emit('command', { command: 'mailto', arg: m }), 1200);
    }
  });
  win.on('close', (e) => {
    if (!isMain || quitting) return;
    const s = backend?.config.getSettings();
    if (s?.closeToTray || isMac) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    windows.delete(win);
    if (win === mainWin) mainWin = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const allowed = process.env['ELECTRON_RENDERER_URL'];
    if (allowed && url.startsWith(allowed)) return;
    e.preventDefault();
    if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url);
  });
  win.webContents.session.setSpellCheckerLanguages(['de-DE', 'en-US'].filter((l) => win.webContents.session.availableSpellCheckerLanguages.includes(l)));

  const target = rendererUrl(route);
  if (target.url) void win.loadURL(target.url);
  else void win.loadFile(target.file!, target.hash ? { hash: target.hash } : undefined);
  return win;
}

function trayImage(): Electron.NativeImage {
  if (isMac) {
    const img = nativeImage.createFromPath(resource('trayTemplate.png'));
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(resource('tray.png'));
}

function command(cmd: string): void {
  showMain();
  emit('command', { command: cmd });
}

function createTray(): void {
  const img = trayImage();
  if (img.isEmpty()) return;
  tray = new Tray(img);
  tray.setToolTip('KS Mail');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'KS Mail öffnen', click: showMain },
      { type: 'separator' },
      { label: 'Neue E-Mail', click: () => command('mail.new') },
      { label: 'Neuer Termin', click: () => command('calendar.newEvent') },
      { label: 'Neue Aufgabe', click: () => command('tasks.new') },
      { label: 'Senden/Empfangen', click: () => emit('command', { command: 'mail.sync' }) },
      { type: 'separator' },
      { label: 'Beenden', click: () => quit() }
    ])
  );
  tray.on('click', () => (mainWin?.isVisible() && !isMac ? mainWin.hide() : showMain()));
}

function menuItem(label: string, cmd: string, accelerator?: string): MenuItemConstructorOptions {
  // accelerators are only shown – the renderer handles the keys itself (configurable shortcuts)
  return { label, accelerator, registerAccelerator: false, click: () => command(cmd) };
}

function buildMenu(): void {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'KS Mail',
      submenu: [
        { role: 'about', label: 'Über KS Mail' },
        { type: 'separator' },
        menuItem('Einstellungen …', 'nav.settings', 'Cmd+,'),
        menuItem('Konten …', 'settings.accounts'),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'KS Mail ausblenden' },
        { role: 'hideOthers', label: 'Andere ausblenden' },
        { role: 'unhide', label: 'Alle einblenden' },
        { type: 'separator' },
        { label: 'KS Mail beenden', accelerator: 'Cmd+Q', click: () => quit() }
      ]
    },
    {
      label: 'Ablage',
      submenu: [
        menuItem('Neue E-Mail', 'mail.new', 'Cmd+N'),
        menuItem('Neuer Termin', 'calendar.newEvent'),
        menuItem('Neuer Kontakt', 'contacts.new'),
        menuItem('Neue Aufgabe', 'tasks.new'),
        menuItem('Neue Notiz', 'notes.new'),
        { type: 'separator' },
        menuItem('Neues Fenster', 'app.newWindow', 'Cmd+Shift+W'),
        { type: 'separator' },
        menuItem('Als .eml speichern …', 'mail.saveAs'),
        menuItem('.eml importieren …', 'mail.importEml'),
        menuItem('Drucken …', 'mail.print', 'Cmd+P'),
        { type: 'separator' },
        { role: 'close', label: 'Fenster schließen' }
      ]
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo', label: 'Widerrufen' },
        { role: 'redo', label: 'Wiederholen' },
        { type: 'separator' },
        { role: 'cut', label: 'Ausschneiden' },
        { role: 'copy', label: 'Kopieren' },
        { role: 'paste', label: 'Einsetzen' },
        { role: 'pasteAndMatchStyle', label: 'Einsetzen und Stil anpassen' },
        { role: 'delete', label: 'Löschen' },
        { role: 'selectAll', label: 'Alles auswählen' },
        { type: 'separator' },
        menuItem('Suchen', 'nav.search', 'Cmd+E'),
        menuItem('Befehlspalette', 'nav.palette', 'Cmd+K'),
        { type: 'separator' },
        { label: 'Sprache', submenu: [{ role: 'startSpeaking', label: 'Sprachausgabe starten' }, { role: 'stopSpeaking', label: 'Sprachausgabe stoppen' }] }
      ]
    },
    {
      label: 'Darstellung',
      submenu: [
        menuItem('E-Mail', 'nav.mail', 'Cmd+1'),
        menuItem('Kalender', 'nav.calendar', 'Cmd+2'),
        menuItem('Kontakte', 'nav.contacts', 'Cmd+3'),
        menuItem('Aufgaben', 'nav.tasks', 'Cmd+4'),
        menuItem('Notizen', 'nav.notes', 'Cmd+5'),
        { type: 'separator' },
        menuItem('Lesebereich rechts', 'view.readingRight'),
        menuItem('Lesebereich unten', 'view.readingBottom'),
        menuItem('Lesebereich aus', 'view.readingOff'),
        menuItem('Ordnerbereich ein/aus', 'view.toggleFolders'),
        { type: 'separator' },
        menuItem('Hell', 'view.themeLight'),
        menuItem('Dunkel', 'view.themeDark'),
        menuItem('Wie System', 'view.themeSystem'),
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Vollbild' },
        { role: 'toggleDevTools', label: 'Entwicklertools' }
      ]
    },
    {
      label: 'Nachricht',
      submenu: [
        menuItem('Antworten', 'mail.reply', 'Cmd+R'),
        menuItem('Allen antworten', 'mail.replyAll', 'Cmd+Shift+R'),
        menuItem('Weiterleiten', 'mail.forward', 'Cmd+F'),
        { type: 'separator' },
        menuItem('Als gelesen markieren', 'mail.markRead', 'Cmd+Q'),
        menuItem('Als ungelesen markieren', 'mail.markUnread', 'Cmd+U'),
        menuItem('Kennzeichnen', 'mail.toggleFlag'),
        menuItem('Archivieren', 'mail.archive'),
        menuItem('Verschieben …', 'mail.move', 'Cmd+Shift+V'),
        menuItem('Junk', 'mail.junk', 'Cmd+J'),
        { type: 'separator' },
        menuItem('Senden/Empfangen', 'mail.sync', 'F9'),
        menuItem('Regeln …', 'settings.rules')
      ]
    },
    { role: 'windowMenu', label: 'Fenster' },
    {
      role: 'help',
      label: 'Hilfe',
      submenu: [menuItem('Tastenkombinationen', 'nav.shortcuts', 'Cmd+/'), menuItem('Datenordner öffnen', 'app.dataDir')]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

let badgeCount = 0;

function setBadge(n: number): void {
  badgeCount = n;
  if (isMac || process.platform === 'linux') app.setBadgeCount(n);
  tray?.setToolTip(n ? `KS Mail – ${n} ungelesen` : 'KS Mail');
  if (process.platform === 'win32' && mainWin) {
    if (n > 0) {
      const label = n > 99 ? '99+' : String(n);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#c50f1f"/><text x="16" y="21.5" font-family="Segoe UI,Arial" font-size="${label.length > 2 ? 12 : 16}" font-weight="700" fill="#fff" text-anchor="middle">${label}</text></svg>`;
      const img = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
      mainWin.setOverlayIcon(img.isEmpty() ? null : img, `${n} ungelesen`);
    } else mainWin.setOverlayIcon(null, '');
  }
}

async function printHtml(html: string): Promise<void> {
  const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise<void>((resolve) => w.webContents.print({ printBackground: true }, () => resolve()));
  w.destroy();
}

function quit(): void {
  quitting = true;
  app.quit();
}

void app.whenReady().then(() => {
  const secure = safeStorage.isEncryptionAvailable();
  setPlatform({
    dataDir: app.getPath('userData'),
    electron: true,
    version: pkg.version,
    secureStorage: secure,
    encrypt: (s) => (secure ? 'enc:' + safeStorage.encryptString(s).toString('base64') : plainEncrypt(s)),
    decrypt: (s) => (s.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(s.slice(4), 'base64')) : plainDecrypt(s)),
    openExternal: (url) => shell.openExternal(url),
    openPath: async (p) => {
      const err = await shell.openPath(p);
      if (err) throw new Error(err);
    },
    showItemInFolder: (p) => shell.showItemInFolder(p),
    saveDialog: async (o) => {
      const r = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() ?? mainWin!, { title: o.title, defaultPath: o.defaultPath, filters: o.filters });
      return r.canceled || !r.filePath ? null : r.filePath;
    },
    openDialog: async (o) => {
      const props: ('openFile' | 'openDirectory' | 'multiSelections' | 'createDirectory')[] = [o.directory ? 'openDirectory' : 'openFile'];
      if (o.multi) props.push('multiSelections');
      if (o.directory) props.push('createDirectory');
      const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() ?? mainWin!, { title: o.title, filters: o.filters, properties: props });
      return r.canceled ? [] : r.filePaths;
    },
    notify: (title, body, onClick, silent) => {
      if (!Notification.isSupported()) return;
      const n = new Notification({ title, body, silent, icon: isMac ? undefined : resource('icon.png') });
      if (onClick)
        n.on('click', () => {
          showMain();
          onClick();
        });
      n.show();
    },
    setBadge,
    printHtml,
    newWindow: (route) => {
      createWindow(route || '/');
    },
    setLoginItem: (enabled, hidden) => {
      app.setLoginItemSettings({ openAtLogin: enabled, args: hidden ? ["--hidden"] : [] });
    },
    quit
  });

  backend = createBackend();
  onEmit((channel, payload) => {
    for (const w of windows) if (!w.isDestroyed()) w.webContents.send(IPC_EVENT, channel, payload);
  });

  ipcMain.handle(IPC_INVOKE, async (_e, method: string, args: unknown[]) => {
    try {
      return { ok: true, value: await dispatch(backend!.api, method, args) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  buildMenu();
  createTray();
  createWindow('');
  const mailto = process.argv.find((a) => a.toLowerCase().startsWith('mailto:'));
  if (mailto) pendingMailto = mailto;

  nativeTheme.on('updated', () => {
    for (const w of windows) {
      if (!isMac && !w.isDestroyed()) w.setTitleBarOverlay?.({ color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#242424', height: 40 });
    }
  });
  ipcMain.on('ksmail:theme', (_e, dark: boolean) => {
    if (isMac) return;
    for (const w of windows) if (!w.isDestroyed()) w.setTitleBarOverlay?.({ color: '#00000000', symbolColor: dark ? '#ffffff' : '#242424', height: 40 });
  });
  ipcMain.on('ksmail:badge-refresh', () => setBadge(badgeCount));

  app.on('activate', () => showMain());
});

app.on('before-quit', () => {
  quitting = true;
});

let shutdownDone = false;
app.on('will-quit', (e) => {
  if (shutdownDone || !backend) return;
  e.preventDefault();
  const b = backend;
  backend = null;
  void b
    .shutdown()
    .catch(() => undefined)
    .finally(() => {
      shutdownDone = true;
      app.quit();
    });
});

app.on('window-all-closed', () => {
  if (!isMac && !tray) quit();
});
