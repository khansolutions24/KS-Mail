// Offline demo account: realistic sample mailbox stored locally, no server needed.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';
import type { Account } from '@shared/types';
import { htmlToText, snippetOf } from '@shared/util';
import type { SyncResult } from './imap';
import { parseRaw, addrList } from './parse';
import type { Remote } from './remote';
import { folderId, type MailStore } from './store';

interface Sample {
  folder: string;
  from: [string, string];
  subject: string;
  html: string;
  hoursAgo: number;
  seen?: boolean;
  flagged?: boolean;
  answered?: boolean;
  attachments?: { filename: string; content: string; contentType: string }[];
  ics?: string;
  cc?: [string, string][];
  thread?: string;
}

function p(...lines: string[]): string {
  return lines.map((l) => `<p>${l}</p>`).join('');
}

function inviteIcs(start: Date, hours: number, title: string, organizer: [string, string], me: string): string {
  const fmt = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const end = new Date(start.getTime() + hours * 3600000);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Demo//DE',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:demo-${crypto.randomUUID()}`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${title}`,
    'LOCATION:Besprechungsraum 2 / Teams',
    `ORGANIZER;CN=${organizer[0]}:mailto:${organizer[1]}`,
    `ATTENDEE;CN=Sie;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${me}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT15M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

function samples(me: string): Sample[] {
  const tomorrow10 = new Date();
  tomorrow10.setDate(tomorrow10.getDate() + 1);
  tomorrow10.setHours(10, 0, 0, 0);
  return [
    {
      folder: 'INBOX',
      from: ['Anna Schneider', 'anna.schneider@beispiel.de'],
      subject: 'Quartalsbericht Q3 – bitte bis Freitag prüfen',
      html: p('Hallo,', 'anbei der Entwurf des Quartalsberichts Q3. Könntest du bitte bis <b>Freitag</b> die Zahlen im Abschnitt Vertrieb gegenprüfen?', 'Vielen Dank und viele Grüße<br>Anna'),
      hoursAgo: 0.3,
      attachments: [{ filename: 'Quartalsbericht_Q3.csv', contentType: 'text/csv', content: 'Region;Umsatz;Vorjahr\nNord;1.240.000;1.100.000\nSüd;980.000;1.020.000\nWest;1.530.000;1.310.000\n' }]
    },
    {
      folder: 'INBOX',
      from: ['Markus Weber', 'm.weber@kunde-gmbh.de'],
      subject: 'Einladung: Projekt-Kickoff Website-Relaunch',
      html: p('Guten Tag,', 'hiermit lade ich Sie zum Kickoff für den Website-Relaunch ein. Agenda: Ziele, Zeitplan, Verantwortlichkeiten.', 'Beste Grüße<br>Markus Weber<br>Kunde GmbH'),
      hoursAgo: 1.5,
      ics: inviteIcs(tomorrow10, 1, 'Projekt-Kickoff Website-Relaunch', ['Markus Weber', 'm.weber@kunde-gmbh.de'], me)
    },
    {
      folder: 'INBOX',
      from: ['GitHub', 'noreply@github.com'],
      subject: '[ks-mail] Pull Request #42: Kalender-Wochenansicht',
      html: p('<b>@lena-dev</b> hat einen Pull Request eröffnet:', '<i>Kalender-Wochenansicht mit Drag & Drop</i>', '3 Dateien geändert, +412 −37'),
      hoursAgo: 3,
      seen: true
    },
    {
      folder: 'INBOX',
      from: ['Lena Hoffmann', 'lena.hoffmann@beispiel.de'],
      subject: 'Mittagessen morgen?',
      html: p('Hey!', 'Hast du morgen Zeit für ein Mittagessen? Ich dachte an den neuen Italiener um die Ecke, so gegen 12:30?', 'LG Lena'),
      hoursAgo: 5,
      flagged: true
    },
    {
      folder: 'INBOX',
      from: ['Deutsche Bahn', 'buchungsbestaetigung@bahn.de'],
      subject: 'Ihre Buchungsbestätigung – Hamburg Hbf → München Hbf',
      html: `<div style="font-family:Arial;border:1px solid #ddd;padding:16px;max-width:560px"><h2 style="color:#ec0016;margin:0 0 12px">Buchungsbestätigung</h2><table style="width:100%;border-collapse:collapse"><tr><td>Hinfahrt</td><td><b>Do, 08:04 Hamburg Hbf</b></td></tr><tr><td>Ankunft</td><td><b>13:45 München Hbf</b></td></tr><tr><td>Wagen/Platz</td><td>Wagen 11, Platz 54</td></tr><tr><td>Preis</td><td>89,90 €</td></tr></table><p style="color:#666;font-size:12px">Bitte führen Sie Ihr Ticket digital oder ausgedruckt mit.</p></div>`,
      hoursAgo: 20,
      seen: true
    },
    {
      folder: 'INBOX',
      from: ['Thomas Krüger', 'thomas.krueger@beispiel.de'],
      subject: 'AW: Budgetplanung 2027',
      html: p('Hallo zusammen,', 'danke für die Rückmeldungen. Ich habe die Punkte eingearbeitet – die aktualisierte Planung liegt im Teams-Kanal.', 'Offene Frage: Sollen wir die Marketingausgaben quartalsweise freigeben?', 'Gruß<br>Thomas'),
      hoursAgo: 26,
      cc: [['Anna Schneider', 'anna.schneider@beispiel.de']],
      thread: 'budget'
    },
    {
      folder: 'INBOX',
      from: ['Newsletter Tech Weekly', 'news@techweekly.example'],
      subject: 'Tech Weekly #312: KI-Agenten, neue Chips und Rust im Kernel',
      html: `<div style="max-width:600px;margin:auto;font-family:Georgia,serif"><h1 style="font-size:24px">Tech Weekly #312</h1><img src="https://images.example.com/header.png" alt="Header" width="600"><h3>1. KI-Agenten in der Praxis</h3><p>Wie Teams Agenten produktiv einsetzen …</p><h3>2. Neue Chips</h3><p>Effizienz statt Takt …</p><p style="font-size:11px;color:#888">Abmelden: siehe Link im Footer.</p></div>`,
      hoursAgo: 30,
      seen: true
    },
    {
      folder: 'INBOX',
      from: ['Sabine Wolf', 'sabine.wolf@partner.example'],
      subject: 'Vertragsentwurf Rahmenvereinbarung',
      html: p('Sehr geehrte Damen und Herren,', 'anbei erhalten Sie den überarbeiteten Vertragsentwurf. Die Änderungen sind farblich markiert.', 'Mit freundlichen Grüßen<br>Sabine Wolf<br>Rechtsabteilung'),
      hoursAgo: 50,
      attachments: [{ filename: 'Rahmenvereinbarung_v3.txt', contentType: 'text/plain', content: '§1 Gegenstand\n§2 Laufzeit: 24 Monate\n§3 Vergütung\n' }]
    },
    {
      folder: 'INBOX',
      from: ['IT-Service', 'it-service@beispiel.de'],
      subject: 'Wartungsfenster am Samstag 22:00–02:00 Uhr',
      html: p('Liebe Kolleginnen und Kollegen,', 'am Samstag finden Wartungsarbeiten an der E-Mail- und VPN-Infrastruktur statt. In dieser Zeit sind die Dienste nicht erreichbar.', 'Ihr IT-Service'),
      hoursAgo: 72,
      seen: true
    },
    {
      folder: 'INBOX',
      from: ['Jonas Becker', 'jonas.becker@beispiel.de'],
      subject: 'Feedback zur Präsentation',
      html: p('Hi,', 'super Präsentation gestern! Zwei kleine Anmerkungen: Folie 7 hat einen Tippfehler und bei Folie 12 würde ich die Grafik größer machen.', 'Viele Grüße<br>Jonas'),
      hoursAgo: 96,
      seen: true,
      answered: true
    },
    {
      folder: 'INBOX',
      from: ['Paketdienst', 'info@paket.example'],
      subject: 'Ihre Sendung wird heute zugestellt',
      html: p('Ihre Sendung <b>00340434161234567890</b> wird heute zwischen 13:00 und 15:00 Uhr zugestellt.'),
      hoursAgo: 120,
      seen: true
    },
    {
      folder: 'INBOX',
      from: ['Claudia Richter', 'claudia.richter@beispiel.de'],
      subject: 'Urlaubsvertretung 14.–25. Oktober',
      html: p('Hallo,', 'während meines Urlaubs übernimmt Jonas meine laufenden Themen. Die Übergabe ist im Wiki dokumentiert.', 'Danke!<br>Claudia'),
      hoursAgo: 170,
      seen: true
    },
    {
      folder: 'Sent',
      from: ['Sie', me],
      subject: 'Budgetplanung 2027',
      html: p('Hallo Thomas,', 'anbei meine Anmerkungen zur Budgetplanung. Insgesamt sieht es gut aus, bei den Reisekosten sollten wir aber nachschärfen.', 'Viele Grüße'),
      hoursAgo: 28,
      seen: true,
      thread: 'budget'
    },
    {
      folder: 'Sent',
      from: ['Sie', me],
      subject: 'AW: Feedback zur Präsentation',
      html: p('Danke Jonas, ist korrigiert!'),
      hoursAgo: 95,
      seen: true
    },
    {
      folder: 'Drafts',
      from: ['Sie', me],
      subject: 'Angebot Website-Relaunch',
      html: p('Sehr geehrter Herr Weber,', 'vielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen folgendes Angebot:'),
      hoursAgo: 4,
      seen: true
    },
    {
      folder: 'Archive',
      from: ['Buchhaltung', 'buchhaltung@beispiel.de'],
      subject: 'Reisekostenabrechnung September genehmigt',
      html: p('Ihre Reisekostenabrechnung für September wurde genehmigt und wird mit dem nächsten Gehaltslauf ausgezahlt.'),
      hoursAgo: 400,
      seen: true
    },
    {
      folder: 'Junk',
      from: ['Gewinnspiel', 'winner@lotto-gewinn.example'],
      subject: 'Herzlichen Glückwunsch! Sie haben gewonnen!!!',
      html: p('Klicken Sie <a href="http://example.com">hier</a>, um Ihren Gewinn abzuholen.'),
      hoursAgo: 10
    }
  ];
}

const FOLDERS: [string, string, string | null][] = [
  ['INBOX', 'Posteingang', 'inbox'],
  ['Drafts', 'Entwürfe', 'drafts'],
  ['Sent', 'Gesendete Elemente', 'sent'],
  ['Archive', 'Archiv', 'archive'],
  ['Junk', 'Junk-E-Mail', 'junk'],
  ['Trash', 'Gelöschte Elemente', 'trash'],
  ['Projekte', 'Projekte', null],
  ['Projekte/Website', 'Website', null]
];

async function build(opts: Mail.Options): Promise<Buffer> {
  const t = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  const info = (await t.sendMail(opts)) as unknown as { message: Buffer };
  return info.message;
}

export class DemoRemote implements Remote {
  onPush: (path: string) => void = () => undefined;
  onFlags: (path: string, uid: number, flags: Set<string>) => void = () => undefined;
  onDisconnect: (err: Error | null) => void = () => undefined;
  private dir: string;

  constructor(
    public account: Account,
    private store: MailStore,
    dataDir: string
  ) {
    this.dir = path.join(dataDir, 'demo', account.id);
  }

  private file(messageId: string): string {
    return path.join(this.dir, crypto.createHash('sha1').update(messageId).digest('hex') + '.eml');
  }

  async seed(): Promise<void> {
    fs.mkdirSync(this.dir, { recursive: true });
    const acc = this.account.id;
    for (const [p, name, special] of FOLDERS) {
      const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : null;
      this.store.upsertFolder({ id: folderId(acc, p), account_id: acc, path: p, name, delimiter: '/', parent_path: parent, special_use: special, unread: 0, total: 0, subscribed: 1, selectable: 1 });
    }
    const threadIds = new Map<string, string>();
    for (const s of samples(this.account.email)) {
      const date = new Date(Date.now() - s.hoursAgo * 3600000);
      const messageId = `<${crypto.randomUUID()}@demo.ksmail>`;
      const parent = s.thread ? threadIds.get(s.thread) : undefined;
      if (s.thread && !parent) threadIds.set(s.thread, messageId);
      const fromMe = s.folder === 'Sent' || s.folder === 'Drafts';
      const raw = await build({
        from: fromMe ? { name: this.account.displayName, address: this.account.email } : { name: s.from[0], address: s.from[1] },
        to: fromMe ? [{ name: 'Thomas Krüger', address: 'thomas.krueger@beispiel.de' }] : [{ name: this.account.displayName, address: this.account.email }],
        cc: s.cc?.map(([name, address]) => ({ name, address })),
        subject: s.subject,
        html: s.html,
        messageId,
        inReplyTo: parent,
        references: parent,
        date,
        attachments: s.attachments,
        icalEvent: s.ics ? { method: 'REQUEST', content: s.ics } : undefined,
        headers: s.from[1].startsWith('news@') ? { 'List-Unsubscribe': '<https://techweekly.example/unsubscribe>' } : undefined
      });
      await this.append(s.folder, raw, [...(s.seen ? ['\\Seen'] : []), ...(s.flagged ? ['\\Flagged'] : []), ...(s.answered ? ['\\Answered'] : [])], date.getTime());
    }
    this.store.recount(FOLDERS.map(([p]) => folderId(acc, p)));
  }

  async syncFolders(): Promise<string[]> {
    return this.store.folders(this.account.id).map((f) => f.id);
  }

  async syncFolder(p: string): Promise<SyncResult> {
    const fid = folderId(this.account.id, p);
    this.store.recount([fid]);
    return { folderId: fid, newIds: [], changed: false, initial: false };
  }

  async loadOlder(): Promise<number> {
    return 0;
  }

  async fetchSource(p: string, uid: number): Promise<Buffer> {
    const row = this.store.byUid(folderId(this.account.id, p), uid);
    if (!row) throw new Error('Nachricht nicht gefunden.');
    return fs.promises.readFile(this.file(row.message_id));
  }

  async setFlags(): Promise<void> {
    // flags live in the local database only
  }

  async move(p: string, uids: number[], target: string): Promise<Map<number, number>> {
    const tfid = folderId(this.account.id, target);
    let next = Math.max(0, this.store.maxUid(tfid)) + 1;
    const map = new Map<number, number>();
    for (const u of uids) map.set(u, next++);
    void p;
    return map;
  }

  async copy(p: string, uids: number[], target: string): Promise<void> {
    for (const u of uids) {
      const row = this.store.byUid(folderId(this.account.id, p), u);
      if (!row) continue;
      const raw = await fs.promises.readFile(this.file(row.message_id));
      const flags = [row.seen ? '\\Seen' : '', row.flagged ? '\\Flagged' : ''].filter(Boolean);
      await this.append(target, raw, flags, row.date);
    }
  }

  async expunge(): Promise<void> {
    // rows are removed by the mail service
  }

  async append(p: string, raw: Buffer, flags: string[], date?: number): Promise<number> {
    fs.mkdirSync(this.dir, { recursive: true });
    const parsed = await parseRaw(raw);
    const messageId = parsed.messageId ?? `<${crypto.randomUUID()}@demo.ksmail>`;
    await fs.promises.writeFile(this.file(messageId), raw);
    const fid = folderId(this.account.id, p);
    const uid = Math.max(0, this.store.maxUid(fid)) + 1;
    const refs = parsed.references ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references]) : [];
    const text = parsed.text || (typeof parsed.html === 'string' ? htmlToText(parsed.html) : '');
    this.store.insert({
      accountId: this.account.id,
      folderId: fid,
      uid,
      messageId,
      inReplyTo: parsed.inReplyTo ?? '',
      references: refs.join(' '),
      subject: parsed.subject ?? '',
      from: addrList(parsed.from)[0] ?? { name: '', address: '' },
      to: addrList(parsed.to),
      cc: addrList(parsed.cc),
      date: date ?? parsed.date?.getTime() ?? Date.now(),
      size: raw.length,
      flags: new Set(flags),
      hasAttachments: parsed.attachments.some((a) => a.contentDisposition !== 'inline'),
      snippet: snippetOf(text),
      headers: {}
    });
    this.store.recount([fid]);
    return uid;
  }

  async createFolder(p: string): Promise<void> {
    const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : null;
    this.store.upsertFolder({
      id: folderId(this.account.id, p),
      account_id: this.account.id,
      path: p,
      name: p.split('/').pop() ?? p,
      delimiter: '/',
      parent_path: parent,
      special_use: null,
      unread: 0,
      total: 0,
      subscribed: 1,
      selectable: 1
    });
  }

  async renameFolder(p: string, newPath: string): Promise<void> {
    await this.createFolder(newPath);
    const from = folderId(this.account.id, p);
    const to = folderId(this.account.id, newPath);
    for (const uid of this.store.uids(from)) {
      const row = this.store.byUid(from, uid);
      if (row) this.store.moveRow(row.id, to, uid);
    }
    this.store.removeFolder(from);
    this.store.recount([to]);
  }

  async deleteFolder(p: string): Promise<void> {
    this.store.removeFolder(folderId(this.account.id, p));
  }

  async search(p: string, text: string): Promise<number[]> {
    const page = this.store.list({ folderId: folderId(this.account.id, p), search: text, limit: 500 }, []);
    return page.items.map((m) => m.uid);
  }

  async ensureCached(): Promise<void> {
    // everything is local
  }

  async idle(): Promise<void> {
    // no server
  }

  async close(): Promise<void> {
    // nothing to close
  }
}
