// vCard 3.0/4.0 import and export.

import type { Contact } from './types';
import { newId } from './util';

export function emptyContact(): Contact {
  return {
    id: newId(),
    firstName: '',
    lastName: '',
    displayName: '',
    emails: [],
    phones: [],
    company: '',
    jobTitle: '',
    department: '',
    address: { street: '', zip: '', city: '', country: '' },
    website: '',
    birthday: '',
    notes: '',
    groups: [],
    favorite: false,
    collected: false,
    updated: Date.now()
  };
}

export function contactName(c: Contact): string {
  return c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.company || c.emails[0]?.value || '(Ohne Namen)';
}

function unesc(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

function esc(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function splitUnescaped(v: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '\\' && i + 1 < v.length) {
      cur += v[i] + v[i + 1];
      i++;
    } else if (v[i] === sep) {
      out.push(cur);
      cur = '';
    } else cur += v[i];
  }
  out.push(cur);
  return out.map(unesc);
}

function typeLabel(params: string): string {
  const t = /TYPE=([^;:]+)/i.exec(params)?.[1]?.toLowerCase() ?? '';
  if (t.includes('work')) return 'Geschäftlich';
  if (t.includes('home')) return 'Privat';
  if (t.includes('cell') || t.includes('mobile')) return 'Mobil';
  if (t.includes('fax')) return 'Fax';
  return 'Sonstige';
}

export function parseVcf(text: string): Contact[] {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const out: Contact[] = [];
  let c: Contact | null = null;
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const head = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const name = head.split(';')[0].replace(/^item\d+\./i, '').toUpperCase();
    const params = head.slice(head.split(';')[0].length);
    if (name === 'BEGIN' && value.toUpperCase() === 'VCARD') c = emptyContact();
    else if (name === 'END' && c) {
      if (!c.displayName) c.displayName = [c.firstName, c.lastName].filter(Boolean).join(' ');
      out.push(c);
      c = null;
    } else if (c) {
      switch (name) {
        case 'FN':
          c.displayName = unesc(value);
          break;
        case 'N': {
          const [last, first] = splitUnescaped(value, ';');
          c.lastName = last ?? '';
          c.firstName = first ?? '';
          break;
        }
        case 'EMAIL':
          c.emails.push({ label: typeLabel(params), value: value.trim() });
          break;
        case 'TEL':
          c.phones.push({ label: typeLabel(params), value: value.replace(/^tel:/i, '').trim() });
          break;
        case 'ORG': {
          const [org, dep] = splitUnescaped(value, ';');
          c.company = org ?? '';
          c.department = dep ?? '';
          break;
        }
        case 'TITLE':
          c.jobTitle = unesc(value);
          break;
        case 'URL':
          c.website = value;
          break;
        case 'BDAY': {
          const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(value);
          c.birthday = m ? `${m[1]}-${m[2]}-${m[3]}` : '';
          break;
        }
        case 'NOTE':
          c.notes = unesc(value);
          break;
        case 'CATEGORIES':
          c.groups = splitUnescaped(value, ',').map((s) => s.trim()).filter(Boolean);
          break;
        case 'ADR': {
          const p = splitUnescaped(value, ';');
          c.address = { street: p[2] ?? '', city: p[3] ?? '', zip: p[5] ?? '', country: p[6] ?? '' };
          break;
        }
      }
    }
  }
  return out;
}

const TYPE_OUT: Record<string, string> = { Geschäftlich: 'WORK', Privat: 'HOME', Mobil: 'CELL', Fax: 'FAX' };

export function toVcf(list: Contact[]): string {
  const out: string[] = [];
  for (const c of list) {
    out.push('BEGIN:VCARD', 'VERSION:3.0', `FN:${esc(contactName(c))}`, `N:${esc(c.lastName)};${esc(c.firstName)};;;`);
    for (const e of c.emails) out.push(`EMAIL;TYPE=INTERNET${TYPE_OUT[e.label] ? ',' + TYPE_OUT[e.label] : ''}:${e.value}`);
    for (const p of c.phones) out.push(`TEL${TYPE_OUT[p.label] ? ';TYPE=' + TYPE_OUT[p.label] : ''}:${p.value}`);
    if (c.company || c.department) out.push(`ORG:${esc(c.company)};${esc(c.department)}`);
    if (c.jobTitle) out.push(`TITLE:${esc(c.jobTitle)}`);
    if (c.website) out.push(`URL:${c.website}`);
    if (c.birthday) out.push(`BDAY:${c.birthday}`);
    if (c.notes) out.push(`NOTE:${esc(c.notes)}`);
    if (c.groups.length) out.push(`CATEGORIES:${c.groups.map(esc).join(',')}`);
    const a = c.address;
    if (a.street || a.city || a.zip || a.country) out.push(`ADR;TYPE=WORK:;;${esc(a.street)};${esc(a.city)};;${esc(a.zip)};${esc(a.country)}`);
    out.push('END:VCARD');
  }
  return out.join('\r\n') + '\r\n';
}
