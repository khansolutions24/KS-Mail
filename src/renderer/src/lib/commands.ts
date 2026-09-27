// Command registry + global keyboard dispatcher. Modules register handlers; shortcuts are configurable.

import { COMMANDS, COMMAND_BY_ID } from '@shared/commands';
import { useApp } from '../store/app';
import { errorMessage } from '../api/client';
import { isTyping, matches, parseKeys, type KeyCombo } from './keys';

type Handler = (arg?: string) => unknown;
const handlers = new Map<string, Handler[]>();

export function registerCommands(map: Record<string, Handler>): () => void {
  for (const [id, h] of Object.entries(map)) {
    const list = handlers.get(id) ?? [];
    list.push(h);
    handlers.set(id, list);
  }
  return () => {
    for (const [id, h] of Object.entries(map)) {
      const list = handlers.get(id) ?? [];
      handlers.set(
        id,
        list.filter((x) => x !== h)
      );
    }
  };
}

export function hasCommand(id: string): boolean {
  return !!handlers.get(id)?.length;
}

export async function runCommand(id: string, arg?: string): Promise<void> {
  const list = handlers.get(id);
  const h = list?.[list.length - 1];
  if (!h) return;
  try {
    await h(arg);
  } catch (err) {
    useApp.getState().toast('error', errorMessage(err));
  }
}

const GLOBAL = new Set(['mail.new', 'mail.sync', 'calendar.newEvent', 'contacts.new', 'tasks.new', 'notes.new', 'mail.outbox']);

type Ctx = 'compose' | 'mail' | 'calendar' | 'global';

export function contextOf(id: string): Ctx {
  if (GLOBAL.has(id)) return 'global';
  const g = COMMAND_BY_ID.get(id)?.group;
  if (g === 'Verfassen') return 'compose';
  if (g === 'E-Mail') return 'mail';
  if (g === 'Kalender') return 'calendar';
  return 'global';
}

/** Effective key bindings: defaults overridden by settings.shortcuts ('' disables) */
export function bindings(): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of COMMANDS) if (c.keys) map.set(c.id, c.keys);
  for (const s of useApp.getState().settings?.shortcuts ?? []) {
    if (s.keys) map.set(s.command, s.keys);
    else map.delete(s.command);
  }
  return map;
}

let parsed: { id: string; combo: KeyCombo; ctx: Ctx }[] = [];
let parsedFrom: unknown = null;

function compiled(): typeof parsed {
  const src = useApp.getState().settings?.shortcuts;
  if (parsedFrom !== src || !parsed.length) {
    parsedFrom = src;
    parsed = [...bindings()].map(([id, keys]) => ({ id, combo: parseKeys(keys)!, ctx: contextOf(id) })).filter((x) => x.combo);
  }
  return parsed;
}

const PRIORITY: Record<Ctx, number> = { compose: 0, mail: 1, calendar: 1, global: 2 };

export function installKeyboard(): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.defaultPrevented) return;
    const app = useApp.getState();
    // dialogs handle their own keys
    if (app.prompt || app.confirm || (app.overlay && app.overlay.kind !== 'shortcuts')) return;
    if (document.querySelector('.dialog')) return;
    const typing = isTyping(e);
    const inComposer = !!(e.target as HTMLElement | null)?.closest?.('.composer');
    const active = new Set<Ctx>(['global']);
    if (inComposer) active.add('compose');
    else if (app.module === 'mail') active.add('mail');
    else if (app.module === 'calendar') active.add('calendar');
    const hits = compiled()
      .filter((b) => active.has(b.ctx) && matches(e, b.combo))
      .sort((a, b) => PRIORITY[a.ctx] - PRIORITY[b.ctx]);
    for (const b of hits) {
      // plain keys (Delete, arrows, Enter …) never fire while typing; Mod+A / Mod+Z etc. stay native in inputs
      if (typing && (!b.combo.mod || (b.combo.mod && ['a', 'c', 'v', 'x', 'z', 'y'].includes(b.combo.key) && !b.combo.shift))) continue;
      if (!hasCommand(b.id)) continue;
      e.preventDefault();
      e.stopPropagation();
      void runCommand(b.id);
      return;
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

export function shortcutFor(id: string): string | undefined {
  return bindings().get(id);
}
