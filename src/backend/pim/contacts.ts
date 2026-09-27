// Address book with vCard / CSV import and automatic collection of recipients.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Address, Contact } from '@shared/types';
import { contactName, emptyContact, parseVcf, toVcf } from '@shared/vcard';
import { newId } from '@shared/util';
import { emit } from '../events';
import { platform } from '../platform';
import type { Db } from '../store/db';

function parseCsv(text: string): string[][] {
  const delim = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const CSV_MAP: Record<string, (c: Contact, v: string) => void> = {
  'first name': (c, v) => (c.firstName = v),
  vorname: (c, v) => (c.firstName = v),
  'last name': (c, v) => (c.lastName = v),
  nachname: (c, v) => (c.lastName = v),
  name: (c, v) => (c.displayName = v),
  'display name': (c, v) => (c.displayName = v),
  anzeigename: (c, v) => (c.displayName = v),
  'e-mail address': (c, v) => v && c.emails.push({ label: 'Geschäftlich', value: v }),
  'e-mail-adresse': (c, v) => v && c.emails.push({ label: 'Geschäftlich', value: v }),
  email: (c, v) => v && c.emails.push({ label: 'Sonstige', value: v }),
  'e-mail': (c, v) => v && c.emails.push({ label: 'Sonstige', value: v }),
  'e-mail 2 address': (c, v) => v && c.emails.push({ label: 'Privat', value: v }),
  'e-mail 2: adresse': (c, v) => v && c.emails.push({ label: 'Privat', value: v }),
  'mobile phone': (c, v) => v && c.phones.push({ label: 'Mobil', value: v }),
  'mobiltelefon': (c, v) => v && c.phones.push({ label: 'Mobil', value: v }),
  'business phone': (c, v) => v && c.phones.push({ label: 'Geschäftlich', value: v }),
  'telefon geschäftlich': (c, v) => v && c.phones.push({ label: 'Geschäftlich', value: v }),
  'home phone': (c, v) => v && c.phones.push({ label: 'Privat', value: v }),
  'telefon privat': (c, v) => v && c.phones.push({ label: 'Privat', value: v }),
  company: (c, v) => (c.company = v),
  firma: (c, v) => (c.company = v),
  'job title': (c, v) => (c.jobTitle = v),
  position: (c, v) => (c.jobTitle = v),
  department: (c, v) => (c.department = v),
  abteilung: (c, v) => (c.department = v),
  'business street': (c, v) => (c.address.street = v),
  'straße geschäftlich': (c, v) => (c.address.street = v),
  'business city': (c, v) => (c.address.city = v),
  'ort geschäftlich': (c, v) => (c.address.city = v),
  'business postal code': (c, v) => (c.address.zip = v),
  'postleitzahl geschäftlich': (c, v) => (c.address.zip = v),
  'business country/region': (c, v) => (c.address.country = v),
  'land/region geschäftlich': (c, v) => (c.address.country = v),
  'web page': (c, v) => (c.website = v),
  webseite: (c, v) => (c.website = v),
  notes: (c, v) => (c.notes = v),
  notizen: (c, v) => (c.notes = v),
  birthday: (c, v) => (c.birthday = v),
  geburtstag: (c, v) => (c.birthday = v)
};

export class ContactService {
  constructor(private db: Db) {}

  list(search?: string): Contact[] {
    const all = this.db.all<{ json: string }>('SELECT json FROM contacts ORDER BY name COLLATE NOCASE').map((r) => JSON.parse(r.json) as Contact);
    if (!search?.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(
      (c) =>
        contactName(c).toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q) ||
        c.emails.some((e) => e.value.toLowerCase().includes(q)) ||
        c.phones.some((p) => p.value.replace(/\s/g, '').includes(q.replace(/\s/g, '')))
    );
  }

  save(c: Contact, silent = false): Contact {
    const contact: Contact = { ...c, id: c.id || newId(), updated: Date.now() };
    if (!contact.displayName) contact.displayName = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
    this.db.run(
      'INSERT INTO contacts(id, name, emails, json) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, emails = excluded.emails, json = excluded.json',
      contact.id,
      contactName(contact),
      contact.emails.map((e) => e.value.toLowerCase()).join(' '),
      JSON.stringify(contact)
    );
    if (!silent) emit('contacts:changed', null);
    return contact;
  }

  remove(ids: string[]): void {
    for (const id of ids) this.db.run('DELETE FROM contacts WHERE id = ?', id);
    emit('contacts:changed', null);
  }

  byEmail(email: string): Contact | null {
    const e = email.toLowerCase().trim();
    if (!e) return null;
    const row = this.db.get<{ json: string }>(`SELECT json FROM contacts WHERE ' ' || emails || ' ' LIKE ? ORDER BY json LIKE '%"collected":true%' LIMIT 1`, `% ${e.replace(/[%_]/g, '')} %`);
    return row ? (JSON.parse(row.json) as Contact) : null;
  }

  isContact(email: string): boolean {
    const c = this.byEmail(email);
    return !!c && !c.collected;
  }

  collect(list: Address[]): void {
    let added = false;
    for (const a of list) {
      if (!a.address || this.byEmail(a.address)) continue;
      const c = emptyContact();
      const parts = a.name.trim().split(/\s+/);
      c.displayName = a.name || a.address;
      if (parts.length > 1) {
        c.firstName = parts.slice(0, -1).join(' ');
        c.lastName = parts[parts.length - 1];
      }
      c.emails = [{ label: 'Sonstige', value: a.address }];
      c.collected = true;
      this.save(c, true);
      added = true;
    }
    if (added) emit('contacts:changed', null);
  }

  suggest(text: string, fromMail: Address[]): { name: string; address: string }[] {
    const q = text.toLowerCase().trim();
    if (!q) return [];
    const out = new Map<string, { name: string; address: string; score: number }>();
    for (const c of this.list(q)) {
      for (const e of c.emails) {
        const k = e.value.toLowerCase();
        if (!out.has(k)) out.set(k, { name: contactName(c), address: e.value, score: c.collected ? 1 : c.favorite ? 3 : 2 });
      }
    }
    for (const a of fromMail) {
      const k = a.address.toLowerCase();
      if (!out.has(k)) out.set(k, { name: a.name, address: a.address, score: 0 });
    }
    return [...out.values()].sort((a, b) => b.score - a.score).slice(0, 10).map(({ name, address }) => ({ name, address }));
  }

  async importVcf(): Promise<number> {
    const files = await platform().openDialog({ title: 'Kontakte importieren', filters: [{ name: 'vCard', extensions: ['vcf', 'vcard'] }], multi: true });
    let n = 0;
    for (const f of files) n += this.importVcfText(await fs.promises.readFile(f, 'utf8'));
    return n;
  }

  importVcfText(text: string): number {
    const list = parseVcf(text);
    this.db.tx(() => {
      for (const c of list) {
        const existing = c.emails[0] ? this.byEmail(c.emails[0].value) : null;
        this.save({ ...c, id: existing?.id ?? c.id, collected: false }, true);
      }
    });
    emit('contacts:changed', null);
    return list.length;
  }

  async importCsv(): Promise<number> {
    const files = await platform().openDialog({ title: 'Kontakte aus CSV importieren', filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (!files[0]) return 0;
    let text = await fs.promises.readFile(files[0], 'utf8');
    if (text.includes('�')) text = (await fs.promises.readFile(files[0])).toString('latin1');
    return this.importCsvText(text);
  }

  importCsvText(text: string): number {
    const rows = parseCsv(text.replace(/^﻿/, ''));
    if (rows.length < 2) return 0;
    const header = rows[0].map((h) => h.trim().toLowerCase());
    let n = 0;
    this.db.tx(() => {
      for (const r of rows.slice(1)) {
        const c = emptyContact();
        header.forEach((h, i) => {
          const v = (r[i] ?? '').trim();
          if (v) CSV_MAP[h]?.(c, v);
        });
        if (!contactName(c) || contactName(c) === '(Ohne Namen)') continue;
        this.save(c, true);
        n++;
      }
    });
    emit('contacts:changed', null);
    return n;
  }

  async exportVcf(ids?: string[]): Promise<string | null> {
    const list = this.list().filter((c) => (ids?.length ? ids.includes(c.id) : !c.collected));
    const target = await platform().saveDialog({
      title: 'Kontakte exportieren',
      defaultPath: path.join(os.homedir(), 'Documents', 'Kontakte.vcf'),
      filters: [{ name: 'vCard', extensions: ['vcf'] }]
    });
    if (!target) return null;
    await fs.promises.writeFile(target, toVcf(list), 'utf8');
    return target;
  }
}
