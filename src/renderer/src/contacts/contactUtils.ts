// Pure helpers for the contacts module: filtering, sorting, grouping and labels.

import type { Contact } from '@shared/types';
import { contactName } from '@shared/vcard';

export const LABELS = ['Geschäftlich', 'Privat', 'Mobil', 'Sonstige', 'Fax'] as const;

/** Left navigation filter */
export type ContactFilter = { kind: 'all' } | { kind: 'favorites' } | { kind: 'collected' } | { kind: 'group'; name: string };

export function filterKey(f: ContactFilter): string {
  return f.kind === 'group' ? `group:${f.name}` : f.kind;
}

export function filterTitle(f: ContactFilter): string {
  switch (f.kind) {
    case 'all':
      return 'Alle Kontakte';
    case 'favorites':
      return 'Favoriten';
    case 'collected':
      return 'Gesammelte Adressen';
    case 'group':
      return f.name;
  }
}

export function matchesFilter(c: Contact, f: ContactFilter): boolean {
  switch (f.kind) {
    case 'all':
      return !c.collected;
    case 'favorites':
      return c.favorite;
    case 'collected':
      return c.collected;
    case 'group':
      return c.groups.includes(f.name);
  }
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function matchesSearch(c: Contact, search: string): boolean {
  const q = fold(search.trim());
  if (!q) return true;
  const hay = fold(
    [contactName(c), c.firstName, c.lastName, c.company, c.department, c.jobTitle, c.address.city, ...c.emails.map((e) => e.value), ...c.phones.map((p) => p.value), ...c.groups].join(' ')
  );
  return q.split(/\s+/).every((part) => hay.includes(part));
}

export function sortContacts(list: Contact[]): Contact[] {
  return [...list].sort((a, b) => contactName(a).localeCompare(contactName(b), 'de', { sensitivity: 'base' }));
}

/** Letter used for the alphabetical group headers (umlauts folded, digits/symbols → '#') */
export function letterOf(c: Contact): string {
  const ch = fold(contactName(c)).charAt(0).toUpperCase();
  return /[A-Z]/.test(ch) ? ch : '#';
}

export function allGroups(list: Contact[]): string[] {
  const set = new Set<string>();
  for (const c of list) for (const g of c.groups) if (g.trim()) set.add(g.trim());
  return [...set].sort((a, b) => a.localeCompare(b, 'de'));
}

export function subtitle(c: Contact): string {
  const job = [c.jobTitle, c.company].filter(Boolean).join(', ');
  return job || c.emails[0]?.value || c.phones[0]?.value || '';
}

export function primaryEmail(c: Contact): string {
  return c.emails.find((e) => e.value.trim())?.value.trim() ?? '';
}

export function formatBirthday(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return v;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function websiteUrl(v: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
}
