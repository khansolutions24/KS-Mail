// Backend → renderer event bus. The host (Electron main or dev server) forwards emitted events.

import type { EventMap, EventName } from '@shared/api';

type Listener = (channel: string, payload: unknown) => void;
const listeners = new Set<Listener>();

export function emit<K extends EventName>(channel: K, payload: EventMap[K]): void {
  for (const l of listeners) {
    try {
      l(channel, payload);
    } catch (err) {
      console.error('[events]', err);
    }
  }
}

export function onEmit(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function toast(kind: 'info' | 'error' | 'success', text: string): void {
  emit('toast', { kind, text });
}
