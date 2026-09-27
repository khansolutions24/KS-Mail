// Sample calendar events, contacts, tasks and notes for the demo account (only added when those stores are empty).

import type { CalendarEvent, Contact, Note, Task } from '@shared/types';
import { emptyContact } from '@shared/vcard';
import { newId } from '@shared/util';
import type { CalendarService } from './calendar';
import type { ContactService } from './contacts';
import { emptyTask, type TaskService } from './tasks';

function at(dayOffset: number, h: number, m = 0): number {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function event(p: Partial<CalendarEvent> & Pick<CalendarEvent, 'title' | 'start' | 'end'>): CalendarEvent {
  return {
    id: '',
    calendarId: 'default',
    uid: '',
    location: '',
    notes: '',
    allDay: false,
    recurrence: null,
    exdates: [],
    reminder: 15,
    showAs: 'busy',
    organizer: null,
    attendees: [],
    categories: [],
    isPrivate: false,
    onlineMeetingUrl: '',
    updated: Date.now(),
    ...p
  };
}

function contact(first: string, last: string, email: string, company: string, extra: Partial<Contact> = {}): Contact {
  return { ...emptyContact(), firstName: first, lastName: last, displayName: `${first} ${last}`, emails: [{ label: 'Geschäftlich', value: email }], company, ...extra };
}

export function seedDemoPim(calendar: CalendarService, contacts: ContactService, tasks: TaskService): void {
  if (!calendar.inRange(Date.now() - 365 * 86400_000, Date.now() + 365 * 86400_000).length) {
    const monday = (() => {
      const d = new Date();
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      d.setHours(9, 30, 0, 0);
      return d.getTime();
    })();
    const events = [
      event({ title: 'Jour fixe Team', start: monday, end: monday + 30 * 60_000, location: 'Teams', recurrence: { freq: 'WEEKLY', interval: 1, byDay: [1] }, categories: ['Blau'], onlineMeetingUrl: 'https://teams.microsoft.com/' }),
      event({ title: 'Kundentermin Kunde GmbH', start: at(0, 14), end: at(0, 15, 30), location: 'Hamburg, Speicherstadt', categories: ['Orange'] }),
      event({ title: 'Mittagessen mit Lena', start: at(1, 12, 30), end: at(1, 13, 30), location: 'Trattoria da Luigi', showAs: 'oof', categories: ['Privat'] }),
      event({ title: 'Quartalsbericht abgeben', start: at(2, 0), end: at(3, 0), allDay: true, showAs: 'free', reminder: 1440, categories: ['Rot'] }),
      event({ title: 'Sprint-Review', start: at(3, 10), end: at(3, 11), location: 'Raum 4.12' }),
      event({ title: 'Zahnarzt', start: at(4, 8), end: at(4, 9), isPrivate: true, showAs: 'oof' }),
      event({ title: 'Workshop Website-Relaunch', start: at(5, 9), end: at(5, 16), location: 'Kunde GmbH', showAs: 'tentative', categories: ['Grün'] }),
      event({ title: 'Reise nach München', start: at(7, 0), end: at(9, 0), allDay: true, showAs: 'oof' })
    ];
    for (const e of events) calendar.save(e, true);
  }
  if (!contacts.list().length) {
    const list = [
      contact('Anna', 'Schneider', 'anna.schneider@beispiel.de', 'Beispiel AG', { jobTitle: 'Controlling', favorite: true, phones: [{ label: 'Mobil', value: '+49 170 1234567' }], groups: ['Team'], birthday: '1988-10-02' }),
      contact('Markus', 'Weber', 'm.weber@kunde-gmbh.de', 'Kunde GmbH', { jobTitle: 'Projektleiter', phones: [{ label: 'Geschäftlich', value: '+49 40 555 1200' }], groups: ['Kunden'], address: { street: 'Am Sandtorkai 1', zip: '20457', city: 'Hamburg', country: 'Deutschland' } }),
      contact('Lena', 'Hoffmann', 'lena.hoffmann@beispiel.de', 'Beispiel AG', { jobTitle: 'Entwicklerin', favorite: true, groups: ['Team'] }),
      contact('Thomas', 'Krüger', 'thomas.krueger@beispiel.de', 'Beispiel AG', { jobTitle: 'Finanzen', groups: ['Team'] }),
      contact('Sabine', 'Wolf', 'sabine.wolf@partner.example', 'Partner & Co. KG', { jobTitle: 'Rechtsabteilung', groups: ['Partner'] }),
      contact('Jonas', 'Becker', 'jonas.becker@beispiel.de', 'Beispiel AG', { jobTitle: 'Marketing', groups: ['Team'] }),
      contact('Claudia', 'Richter', 'claudia.richter@beispiel.de', 'Beispiel AG', { jobTitle: 'Vertrieb', groups: ['Team'] })
    ];
    for (const c of list) contacts.save(c, true);
  }
  if (!tasks.list().length) {
    const listId = tasks.lists()[0].id;
    const mk = (p: Partial<Task>): Task => ({ ...emptyTask(listId), ...p, id: newId() });
    const items = [
      mk({ title: 'Zahlen im Quartalsbericht prüfen', due: at(2, 17), important: true, myDay: true, steps: [{ id: newId(), title: 'Vertrieb Nord', done: true }, { id: newId(), title: 'Vertrieb Süd', done: false }] }),
      mk({ title: 'Angebot Website-Relaunch schreiben', due: at(1, 12), priority: 'high', notes: 'Budgetrahmen mit Markus klären' }),
      mk({ title: 'Reisekosten September einreichen', due: at(-1, 17) }),
      mk({ title: 'Blumen gießen', recurrence: { freq: 'WEEKLY', interval: 1 }, due: at(3, 18) }),
      mk({ title: 'Präsentation korrigieren', done: true, completedAt: Date.now() - 86400_000 })
    ];
    for (const t of items) tasks.save(t);
  }
  if (!tasks.notes().length) {
    const notes: Note[] = [
      { id: '', title: 'Ideen Relaunch', body: '• Dunkles Design\n• Schnellere Ladezeiten\n• Newsletter-Anmeldung prominenter', color: 'yellow', updated: Date.now() },
      { id: '', title: 'WLAN Büro', body: 'Netz: Beispiel-Gast\nPasswort steht am Empfang', color: 'blue', updated: Date.now() - 3600_000 }
    ];
    for (const n of notes) tasks.saveNote(n);
  }
}
