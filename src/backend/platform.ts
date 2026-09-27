// Host capabilities that differ between Electron and the browser dev server.

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface Platform {
  dataDir: string;
  electron: boolean;
  version: string;
  /** Encrypts a secret for storage on disk (OS keychain / DPAPI via safeStorage) */
  encrypt(plain: string): string;
  decrypt(stored: string): string;
  secureStorage: boolean;
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<void>;
  showItemInFolder(path: string): void;
  saveDialog(opts: { title: string; defaultPath: string; filters?: FileFilter[] }): Promise<string | null>;
  openDialog(opts: { title: string; filters?: FileFilter[]; multi?: boolean; directory?: boolean }): Promise<string[]>;
  notify(title: string, body: string, onClick?: () => void, silent?: boolean): void;
  setBadge(count: number): void;
  printHtml(html: string): Promise<void>;
  newWindow(route: string): void;
  setLoginItem(enabled: boolean, hidden: boolean): void;
  quit(): void;
}

function plainEncrypt(s: string): string {
  return 'plain:' + Buffer.from(s, 'utf8').toString('base64');
}

function plainDecrypt(s: string): string {
  return Buffer.from(s.replace(/^plain:/, ''), 'base64').toString('utf8');
}

let current: Platform = {
  dataDir: process.cwd() + '/.devdata',
  electron: false,
  version: '0.0.0',
  encrypt: plainEncrypt,
  decrypt: plainDecrypt,
  secureStorage: false,
  openExternal: async (url) => console.log('[platform] open', url),
  openPath: async (p) => console.log('[platform] openPath', p),
  showItemInFolder: (p) => console.log('[platform] show', p),
  saveDialog: async () => null,
  openDialog: async () => [],
  notify: (title, body) => console.log('[notify]', title, '-', body),
  setBadge: () => undefined,
  printHtml: async () => undefined,
  newWindow: () => undefined,
  setLoginItem: () => undefined,
  quit: () => process.exit(0)
};

export function setPlatform(p: Partial<Platform>): void {
  current = { ...current, ...p };
}

export function platform(): Platform {
  return current;
}

export { plainEncrypt, plainDecrypt };
