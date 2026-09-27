// Small helpers without Node or DOM dependencies.

import type { Address } from './types';

export function newId(): string {
  const rnd = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}${rnd}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function textToHtml(text: string): string {
  return escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\r?\n/g, '<br>');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', euro: '€' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

/** Rough HTML → plain text for snippets, plain-text alternatives and quoting */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function snippetOf(text: string, max = 200): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function formatAddress(a: Address): string {
  if (!a.name || a.name === a.address) return a.address;
  const name = /[",;<>@()]/.test(a.name) ? `"${a.name.replace(/"/g, '\\"')}"` : a.name;
  return `${name} <${a.address}>`;
}

export function formatAddressList(list: Address[]): string {
  return list.map(formatAddress).join(', ');
}

/** Splits "A <a@x>, "B, C" <b@x>; c@x" into addresses */
export function parseAddressList(input: string): Address[] {
  const out: Address[] = [];
  let cur = '';
  let quoted = false;
  let angle = false;
  const flush = (): void => {
    const s = cur.trim();
    cur = '';
    if (!s) return;
    const m = /^(.*?)<([^>]+)>\s*$/.exec(s);
    if (m) {
      const name = m[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"');
      out.push({ name, address: m[2].trim() });
    } else {
      out.push({ name: '', address: s.replace(/^"(.*)"$/, '$1') });
    }
  };
  for (const ch of input) {
    if (ch === '"' && !angle) quoted = !quoted;
    else if (ch === '<' && !quoted) angle = true;
    else if (ch === '>' && !quoted) angle = false;
    if ((ch === ',' || ch === ';') && !quoted && !angle) {
      flush();
      continue;
    }
    cur += ch;
  }
  flush();
  return out;
}

export function isValidEmail(s: string): boolean {
  return /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/.test(s.trim());
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export function normalizeSubject(s: string): string {
  let prev = '';
  let cur = s.trim();
  while (prev !== cur) {
    prev = cur;
    cur = cur.replace(/^(re|aw|wg|fw|fwd|antw|sv|vs|tr)(\[\d+\])?\s*:\s*/i, '').trim();
  }
  return cur.toLowerCase();
}

export function prefixSubject(prefix: 'AW' | 'WG', subject: string): string {
  const s = subject.trim();
  const re = prefix === 'AW' ? /^(re|aw|antw)\s*:/i : /^(fw|fwd|wg)\s*:/i;
  return re.test(s) ? s : `${prefix}: ${s}`;
}

export function initials(name: string): string {
  const parts = name.replace(/[<>"@].*$/, '').trim().split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return '?';
  const a = parts[0][0] ?? '';
  const b = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : (parts[0][1] ?? '');
  return (a + b).toUpperCase();
}

const PALETTE = ['#0f6cbd', '#c239b3', '#e3008c', '#ca5010', '#498205', '#038387', '#8764b8', '#986f0b', '#004e8c', '#d13438', '#5c2e91', '#00666d'];

export function colorFor(s: string): string {
  let h = 0;
  for (const ch of s.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base;
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return (patch as T) ?? base;
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'unbenannt';
}
