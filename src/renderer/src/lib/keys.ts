// Keyboard shortcut parsing, matching and display.

import { isMac } from '../api/client';

export interface KeyCombo {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

export function parseKeys(s: string): KeyCombo | null {
  if (!s) return null;
  const parts = s.split('+').map((p) => p.trim());
  let key = parts.pop() ?? '';
  if (key === '' && s.endsWith('+')) key = '+';
  const set = new Set(parts.map((p) => p.toLowerCase()));
  return { mod: set.has('mod') || set.has('ctrl') || set.has('cmd'), shift: set.has('shift'), alt: set.has('alt') || set.has('option'), key: key.length === 1 ? key.toLowerCase() : key };
}

function eventKey(e: KeyboardEvent): string {
  if (e.code.startsWith('Digit')) return e.code.slice(5);
  if (e.code.startsWith('Key')) return e.code.slice(3).toLowerCase();
  if (e.code === 'Comma') return ',';
  if (e.code === 'Slash' || e.key === '/') return '/';
  if (e.code === 'Equal' || e.key === '+') return '=';
  if (e.code === 'Minus') return '-';
  if (e.code === 'Period') return '.';
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

export function matches(e: KeyboardEvent, combo: KeyCombo): boolean {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod !== combo.mod || e.shiftKey !== combo.shift || e.altKey !== combo.alt) return false;
  if (isMac && e.ctrlKey && !combo.mod) return false;
  return eventKey(e) === combo.key;
}

/** Converts a keydown event into the stored notation, e.g. "Mod+Shift+R" */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const k = eventKey(e);
  parts.push(k.length === 1 ? k.toUpperCase() : k);
  return parts.join('+');
}

const NAMES: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Delete: isMac ? '⌦' : 'Entf',
  Backspace: isMac ? '⌫' : 'Rücktaste',
  Enter: isMac ? '↩' : 'Eingabe',
  Escape: 'Esc',
  Insert: 'Einfg',
  Home: 'Pos1'
};

export function formatKeys(s: string | undefined): string {
  if (!s) return '';
  return s
    .split('+')
    .map((p) => {
      if (p === 'Mod') return isMac ? '⌘' : 'Strg';
      if (p === 'Shift') return isMac ? '⇧' : 'Umschalt';
      if (p === 'Alt') return isMac ? '⌥' : 'Alt';
      return NAMES[p] ?? (p.length === 1 ? p.toUpperCase() : p);
    })
    .join(isMac ? '' : '+');
}

export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}
