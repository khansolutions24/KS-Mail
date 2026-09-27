// RPC client: Electron IPC (preload bridge) or WebSocket to the dev server in a normal browser.

import type { Api, EventMap, EventName } from '@shared/api';

interface Bridge {
  platform: string;
  invoke(method: string, args: unknown[]): Promise<{ ok: true; value: unknown } | { ok: false; error: string }>;
  onEvent(cb: (channel: string, payload: unknown) => void): () => void;
  setTheme?(dark: boolean): void;
  pathForFile?(file: File): string;
}

declare global {
  interface Window {
    ksMail?: Bridge;
  }
}

type Listener = (payload: unknown) => void;
const listeners = new Map<string, Set<Listener>>();

function dispatchEvent(channel: string, payload: unknown): void {
  for (const l of listeners.get(channel) ?? []) {
    try {
      l(payload);
    } catch (err) {
      console.error(err);
    }
  }
}

let invokeImpl: (method: string, args: unknown[]) => Promise<unknown>;

if (window.ksMail) {
  const bridge = window.ksMail;
  bridge.onEvent(dispatchEvent);
  invokeImpl = async (method, args) => {
    const r = await bridge.invoke(method, args);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };
} else {
  // browser dev mode
  let ws: WebSocket | null = null;
  let ready: Promise<WebSocket> | null = null;
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const connect = (): Promise<WebSocket> => {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
      const s = new WebSocket('ws://127.0.0.1:5199');
      s.onopen = () => {
        ws = s;
        resolve(s);
      };
      s.onerror = () => reject(new Error('Backend nicht erreichbar (npm run dev:web)'));
      s.onclose = () => {
        ws = null;
        ready = null;
        for (const p of pending.values()) p.reject(new Error('Verbindung zum Backend getrennt'));
        pending.clear();
        setTimeout(() => void connect().catch(() => undefined), 1000);
      };
      s.onmessage = (e) => {
        const msg = JSON.parse(String(e.data)) as { type: string; id: number; ok: boolean; value: unknown; error: string; channel: string; payload: unknown };
        if (msg.type === 'event') dispatchEvent(msg.channel, msg.payload);
        else {
          const p = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.ok) p?.resolve(msg.value);
          else p?.reject(new Error(msg.error));
        }
      };
    });
    return ready;
  };
  invokeImpl = async (method, args) => {
    const s = ws ?? (await connect());
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      s.send(JSON.stringify({ id, method, args }));
    });
  };
}

export const api = new Proxy({} as Api, {
  get(_t, ns: string) {
    return new Proxy(
      {},
      {
        get(_t2, fn: string) {
          return (...args: unknown[]) => invokeImpl(`${ns}.${fn}`, args);
        }
      }
    );
  }
});

export function onEvent<K extends EventName>(channel: K, cb: (payload: EventMap[K]) => void): () => void {
  const set = listeners.get(channel) ?? new Set();
  set.add(cb as Listener);
  listeners.set(channel, set);
  return () => set.delete(cb as Listener);
}

export function errorMessage(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

export const platform = window.ksMail?.platform ?? (navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'web');
export const isMac = platform === 'darwin';
export const isElectron = !!window.ksMail;

export function setNativeTheme(dark: boolean): void {
  window.ksMail?.setTheme?.(dark);
}

export function pathForFile(file: File): string {
  return window.ksMail?.pathForFile?.(file) ?? '';
}
