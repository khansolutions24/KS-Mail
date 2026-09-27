// Calendars, events, reminders, iCalendar import/export, subscriptions and meeting invitations.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Attendee, Calendar, CalendarEvent, Draft, EventOccurrence } from '@shared/types';
import { defaultCalendar } from '@shared/defaults';
import { buildIcs, parseIcs } from '@shared/ics';
import { expandEvent, expandEvents } from '@shared/recurrence';
import { escapeHtml, newId, safeFileName } from '@shared/util';
import { emit } from '../events';
import { platform } from '../platform';
import type { ConfigStore } from '../store/config';
import type { Db } from '../store/db';
import type { MailService } from '../mail/service';
import * as graph from '../mail/graph';

interface EventRow {
  id: string;
  json: string;
}

export class CalendarService {
  private reminderTimer: NodeJS.Timeout | null = null;
  private subTimer: NodeJS.Timeout | null = null;

  constructor(
    private db: Db,
    private config: ConfigStore,
    private mail: MailService
  ) {
    if (!this.calendars().length) this.saveCalendar(defaultCalendar());
  }

  start(): void {
    this.reminderTimer = setInterval(() => this.checkReminders(), 20_000);
    setTimeout(() => this.checkReminders(), 3000);
    const refreshAll = (): void => {
      for (const c of this.calendars()) if (c.subscriptionUrl) void this.refreshSubscription(c.id).catch(() => undefined);
    };
    setTimeout(refreshAll, 5000);
    this.subTimer = setInterval(refreshAll, 60 * 60_000);
    setTimeout(() => void this.syncAllGraph(), 4000);
    this.graphTimer = setInterval(() => void this.syncAllGraph(), 5 * 60_000);
  }

  // ───────────────────────── Microsoft 365 (Graph) ─────────────────────────

  private graphTimer: NodeJS.Timeout | null = null;
  private graphSyncing = new Map<string, Promise<number>>();

  private graphAccounts(): string[] {
    return this.config
      .listAccounts()
      .filter((a) => a.enabled && this.mail.usesGraph(a) && a.calendarSync !== false)
      .map((a) => a.id);
  }

  async syncAllGraph(): Promise<void> {
    for (const id of this.graphAccounts()) {
      await this.syncGraph(id).catch((err) => console.warn('[calendar] Microsoft 365 sync failed:', (err as Error).message));
    }
  }

  /** Mirrors all calendars of a Microsoft 365 account (occurrences from 90 days ago to about a year ahead) */
  syncGraph(accountId: string): Promise<number> {
    const running = this.graphSyncing.get(accountId);
    if (running) return running;
    const p = this.syncGraphNow(accountId).finally(() => this.graphSyncing.delete(accountId));
    this.graphSyncing.set(accountId, p);
    return p;
  }

  private async syncGraphNow(accountId: string): Promise<number> {
    const account = this.config.getAccount(accountId);
    if (!account) return 0;
    const token = await this.mail.graphToken(accountId);
    const remote = await graph.calendars(token);
    const existing = this.calendars().filter((c) => c.remote?.accountId === accountId);
    const from = Date.now() - 90 * 86400_000;
    const to = Date.now() + 400 * 86400_000;
    let count = 0;
    const views = new Map<string, Awaited<ReturnType<typeof graph.calendarView>>>();
    for (const rc of remote) views.set(rc.id, await graph.calendarView(token, rc.id, from, to));
    this.db.tx(() => {
      for (const rc of remote) {
        const id = `g:${accountId}:${rc.id}`;
        const prev = existing.find((c) => c.id === id);
        const label = rc.isDefaultCalendar ? `${rc.name} (${account.name || account.email})` : rc.name;
        const cal: Calendar = {
          id,
          name: prev?.name ?? label,
          color: prev?.color ?? (rc.hexColor && /^#[0-9a-f]{6}$/i.test(rc.hexColor) ? rc.hexColor : account.color),
          visible: prev?.visible ?? true,
          remote: { kind: 'graph', accountId, id: rc.id, canEdit: rc.canEdit !== false }
        };
        this.db.run('INSERT INTO calendars(id, json) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json', id, JSON.stringify(cal));
        this.db.run('DELETE FROM events WHERE calendar_id = ?', id);
        for (const g of views.get(rc.id) ?? []) {
          const ev = graph.toLocalEvent(g, id);
          this.save({ ...ev, id: `g:${g.id}` }, true);
          count++;
        }
      }
      for (const c of existing) {
        if (remote.some((rc) => `g:${accountId}:${rc.id}` === c.id)) continue;
        this.db.run('DELETE FROM events WHERE calendar_id = ?', c.id);
        this.db.run('DELETE FROM calendars WHERE id = ?', c.id);
      }
    });
    // new events go to the Exchange calendar unless the user chose another default
    const s = this.config.getSettings();
    const def = remote.find((c) => c.isDefaultCalendar);
    if (def && !s.calendar.defaultCalendarId) {
      this.config.updateSettings({ calendar: { ...s.calendar, defaultCalendarId: `g:${accountId}:${def.id}` } });
      emit('settings:changed', this.config.getSettings());
    }
    emit('calendar:changed', null);
    return count;
  }

  /** Removes the mirrored Microsoft 365 calendars of an account (sync switched off or account removed) */
  dropGraph(accountId: string): void {
    const cals = this.calendars().filter((c) => c.remote?.accountId === accountId);
    if (!cals.length) return;
    this.db.tx(() => {
      for (const c of cals) {
        this.db.run('DELETE FROM events WHERE calendar_id = ?', c.id);
        this.db.run('DELETE FROM calendars WHERE id = ?', c.id);
      }
    });
    const s = this.config.getSettings();
    if (cals.some((c) => c.id === s.calendar.defaultCalendarId)) this.config.updateSettings({ calendar: { ...s.calendar, defaultCalendarId: null } });
    emit('calendar:changed', null);
  }

  private remoteCalendar(calendarId: string): Calendar | null {
    const c = this.calendars().find((x) => x.id === calendarId);
    return c?.remote ? c : null;
  }

  /** Saves an event; events in Microsoft 365 calendars are written to Exchange first */
  async saveAny(e: CalendarEvent): Promise<CalendarEvent> {
    const target = this.remoteCalendar(e.calendarId);
    const prev = e.id ? this.get(e.id) : null;
    const prevCal = prev ? this.remoteCalendar(prev.calendarId) : null;
    if (target && !target.remote!.canEdit) throw new Error(`Der Kalender „${target.name}“ ist schreibgeschützt.`);
    // moved out of an Exchange calendar: remove it there
    if (prev?.remote && prevCal && prevCal.id !== target?.id) {
      await graph.deleteEvent(await this.mail.graphToken(prevCal.remote!.accountId), prev.remote.id);
      this.db.run('DELETE FROM events WHERE id = ?', prev.id);
      if (!target) return this.save({ ...e, id: '', remote: null, uid: '' });
    }
    if (!target) return this.save(e);
    const token = await this.mail.graphToken(target.remote!.accountId);
    let remoteId: string;
    if (prev?.remote && prevCal?.id === target.id) {
      remoteId = prev.remote.id;
      await graph.updateEvent(token, remoteId, e);
    } else {
      remoteId = await graph.createEvent(token, target.remote!.id, e);
    }
    await this.syncGraph(target.remote!.accountId);
    return this.get(`g:${remoteId}`) ?? { ...e, id: `g:${remoteId}` };
  }

  async removeAny(id: string, occurrenceStart?: number): Promise<void> {
    const ev = this.get(id);
    const cal = ev ? this.remoteCalendar(ev.calendarId) : null;
    if (ev?.remote && cal) {
      if (!cal.remote!.canEdit) throw new Error(`Der Kalender „${cal.name}“ ist schreibgeschützt.`);
      await graph.deleteEvent(await this.mail.graphToken(cal.remote!.accountId), ev.remote.id);
      this.db.run('DELETE FROM events WHERE id = ?', id);
      emit('calendar:changed', null);
      return;
    }
    this.remove(id, occurrenceStart);
  }

  stop(): void {
    if (this.graphTimer) clearInterval(this.graphTimer);
    if (this.reminderTimer) clearInterval(this.reminderTimer);
    if (this.subTimer) clearInterval(this.subTimer);
  }

  calendars(): Calendar[] {
    return this.db.all<{ json: string }>('SELECT json FROM calendars').map((r) => JSON.parse(r.json) as Calendar);
  }

  saveCalendar(c: Calendar): Calendar {
    const cal = { ...c, id: c.id || newId() };
    this.db.run('INSERT INTO calendars(id, json) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json', cal.id, JSON.stringify(cal));
    emit('calendar:changed', null);
    return cal;
  }

  removeCalendar(id: string): void {
    if (this.remoteCalendar(id)) throw new Error('Dieser Kalender wird über Microsoft 365 verwaltet. Blenden Sie ihn aus oder deaktivieren Sie die Kalendersynchronisation im Konto.');
    if (this.calendars().length <= 1) throw new Error('Der letzte Kalender kann nicht gelöscht werden.');
    this.db.run('DELETE FROM events WHERE calendar_id = ?', id);
    this.db.run('DELETE FROM calendars WHERE id = ?', id);
    emit('calendar:changed', null);
  }

  private all(): CalendarEvent[] {
    return this.db.all<EventRow>('SELECT id, json FROM events').map((r) => JSON.parse(r.json) as CalendarEvent);
  }

  inRange(from: number, to: number): CalendarEvent[] {
    return this.db
      .all<EventRow>('SELECT id, json FROM events WHERE (recurring = 1 AND start < ? AND (until IS NULL OR until >= ?)) OR (recurring = 0 AND start < ? AND end >= ?)', to, from, to, from)
      .map((r) => JSON.parse(r.json) as CalendarEvent);
  }

  occurrences(from: number, to: number): EventOccurrence[] {
    const visible = new Set(this.calendars().filter((c) => c.visible).map((c) => c.id));
    return expandEvents(
      this.inRange(from, to).filter((e) => visible.has(e.calendarId)),
      from,
      to
    );
  }

  get(id: string): CalendarEvent | null {
    const r = this.db.get<EventRow>('SELECT id, json FROM events WHERE id = ?', id);
    return r ? (JSON.parse(r.json) as CalendarEvent) : null;
  }

  /** The series master / single event (recurrenceId null) or a specific exception of a series */
  byUid(uid: string, recurrenceId: number | null = null): CalendarEvent | null {
    const rows = this.db.all<EventRow>('SELECT id, json FROM events WHERE uid = ?', uid).map((r) => JSON.parse(r.json) as CalendarEvent);
    return rows.find((e) => (e.recurrenceId ?? null) === recurrenceId) ?? null;
  }

  /** Stores an exception of a series: the master gets an EXDATE so the occurrence is not shown twice */
  private saveException(e: CalendarEvent, calendarId: string): void {
    const master = this.byUid(e.uid);
    if (master && e.recurrenceId != null && !master.exdates.includes(e.recurrenceId)) this.save({ ...master, exdates: [...master.exdates, e.recurrenceId] }, true);
    const existing = this.byUid(e.uid, e.recurrenceId ?? null);
    this.save({ ...e, id: existing?.id ?? e.id, calendarId: master?.calendarId ?? calendarId, recurrence: null }, true);
  }

  save(e: CalendarEvent, silent = false): CalendarEvent {
    const ev: CalendarEvent = { ...e, id: e.id || newId(), uid: e.uid || `${newId()}@ksmail`, updated: Date.now() };
    if (ev.end < ev.start) ev.end = ev.start;
    const until = ev.recurrence?.until ?? null;
    this.db.run(
      `INSERT INTO events(id, calendar_id, uid, start, end, recurring, until, json) VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET calendar_id=excluded.calendar_id, uid=excluded.uid, start=excluded.start, end=excluded.end,
       recurring=excluded.recurring, until=excluded.until, json=excluded.json`,
      ev.id,
      ev.calendarId,
      ev.uid,
      ev.start,
      ev.end,
      ev.recurrence ? 1 : 0,
      until,
      JSON.stringify(ev)
    );
    if (!silent) emit('calendar:changed', null);
    return ev;
  }

  remove(id: string, occurrenceStart?: number): void {
    const ev = this.get(id);
    if (!ev) return;
    if (occurrenceStart !== undefined && ev.recurrence) {
      ev.exdates = [...ev.exdates, occurrenceStart];
      this.save(ev);
      return;
    }
    this.db.run('DELETE FROM events WHERE id = ?', id);
    emit('calendar:changed', null);
  }

  importText(calendarId: string, text: string): number {
    const { events } = parseIcs(text, calendarId);
    this.db.tx(() => {
      // masters first, then their exceptions (RECURRENCE-ID)
      for (const e of [...events].sort((a, b) => Number(a.recurrenceId != null) - Number(b.recurrenceId != null))) {
        if (e.recurrenceId != null) {
          this.saveException(e, calendarId);
          continue;
        }
        const existing = this.byUid(e.uid);
        // keep exdates created by already stored exceptions
        const exdates = [...new Set([...e.exdates, ...(existing?.exdates ?? [])])];
        this.save({ ...e, id: existing?.id ?? e.id, calendarId, exdates }, true);
      }
    });
    emit('calendar:changed', null);
    return events.length;
  }

  async importIcs(calendarId: string, text?: string): Promise<number> {
    if (text) return this.importText(calendarId, text);
    const files = await platform().openDialog({ title: 'Kalender importieren', filters: [{ name: 'iCalendar', extensions: ['ics', 'ical', 'ifb'] }], multi: true });
    let n = 0;
    for (const f of files) n += this.importText(calendarId, await fs.promises.readFile(f, 'utf8'));
    return n;
  }

  async exportIcs(calendarId: string): Promise<string | null> {
    const cal = this.calendars().find((c) => c.id === calendarId);
    const events = this.all().filter((e) => e.calendarId === calendarId);
    const target = await platform().saveDialog({
      title: 'Kalender exportieren',
      defaultPath: path.join(os.homedir(), 'Documents', safeFileName(cal?.name ?? 'Kalender') + '.ics'),
      filters: [{ name: 'iCalendar', extensions: ['ics'] }]
    });
    if (!target) return null;
    await fs.promises.writeFile(target, buildIcs(events, { name: cal?.name }), 'utf8');
    return target;
  }

  async refreshSubscription(calendarId: string): Promise<number> {
    const cal = this.calendars().find((c) => c.id === calendarId);
    if (cal?.remote) return this.syncGraph(cal.remote.accountId);
    if (!cal?.subscriptionUrl) throw new Error('Kein abonnierter Kalender.');
    const url = cal.subscriptionUrl.replace(/^webcals?:\/\//i, 'https://');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Abruf fehlgeschlagen: HTTP ${res.status}`);
    const text = await res.text();
    const { events } = parseIcs(text, calendarId);
    this.db.tx(() => {
      this.db.run('DELETE FROM events WHERE calendar_id = ?', calendarId);
      for (const e of events) this.save({ ...e, calendarId, reminder: null }, true);
    });
    emit('calendar:changed', null);
    return events.length;
  }

  private checkReminders(): void {
    const now = Date.now();
    const fired = this.db.kvGet<Record<string, number>>('reminders.fired', {});
    let dirty = false;
    // events
    const occ = expandEvents(this.inRange(now - 3600_000, now + 7 * 86400_000), now - 3600_000, now + 7 * 86400_000);
    for (const o of occ) {
      if (o.event.reminder == null) continue;
      const at = o.start - o.event.reminder * 60_000;
      const key = `${o.event.id}@${o.start}`;
      if (at > now || fired[key] || o.end < now) continue;
      fired[key] = now;
      dirty = true;
      const when = o.event.allDay ? 'Heute (ganztägig)' : new Date(o.start).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      platform().notify(`Erinnerung: ${o.event.title}`, `${when}${o.event.location ? ' · ' + o.event.location : ''}`, () =>
        emit('command', { command: 'open.event', arg: o.event.id })
      );
      emit('notify', { kind: 'reminder', title: o.event.title, body: when, ref: { eventId: o.event.id } });
    }
    // tasks
    for (const r of this.db.all<{ json: string }>('SELECT json FROM tasks')) {
      const t = JSON.parse(r.json) as { id: string; title: string; reminder: number | null; done: boolean };
      if (!t.reminder || t.done || t.reminder > now) continue;
      const key = `task:${t.id}@${t.reminder}`;
      if (fired[key]) continue;
      fired[key] = now;
      dirty = true;
      platform().notify('Aufgabe fällig', t.title, () => emit('command', { command: 'open.task', arg: t.id }));
      emit('notify', { kind: 'reminder', title: t.title, body: 'Aufgabe', ref: { taskId: t.id } });
    }
    if (dirty) {
      for (const [k, v] of Object.entries(fired)) if (v < now - 30 * 86400_000) delete fired[k];
      this.db.kvSet('reminders.fired', fired);
    }
  }

  /** Accept / decline / tentative for an invitation mail; adds the event and replies to the organizer */
  async respond(messageId: number, response: 'accepted' | 'declined' | 'tentative', calendarId: string): Promise<void> {
    const body = await this.mail.body(messageId);
    const header = this.mail.get(messageId);
    if (!body.invite?.length || !header) throw new Error('Keine Einladung in dieser Nachricht.');
    const account = this.config.getAccount(header.accountId);
    if (!account) throw new Error('Konto nicht gefunden.');
    // Microsoft 365 already put the invitation into the Exchange calendar: answer it there
    if (this.mail.usesGraph(account) && account.calendarSync !== false) {
      const token = await this.mail.graphToken(account.id);
      let handled = 0;
      for (const inv of body.invite) if (await graph.respondByUid(token, inv.uid, response, '')) handled++;
      if (handled === body.invite.length) {
        await this.syncGraph(account.id).catch(() => undefined);
        return;
      }
    }
    const me = account.email.toLowerCase();
    for (const inv of body.invite) {
      const attendees: Attendee[] = inv.attendees.some((a) => a.email.toLowerCase() === me)
        ? inv.attendees.map((a) => (a.email.toLowerCase() === me ? { ...a, status: response } : a))
        : [...inv.attendees, { name: account.displayName, email: account.email, status: response }];
      const rid = inv.recurrenceId ?? null;
      const found = this.byUid(inv.uid, rid);
      // only an invitation from the same organizer may update or remove an existing event
      const sameOrganizer = (e: CalendarEvent | null): boolean => !!e && (e.organizer?.address ?? '').toLowerCase() === (inv.organizer?.address ?? '').toLowerCase();
      const existing = sameOrganizer(found) ? found : null;
      const master = rid != null ? this.byUid(inv.uid) : null;
      const showAs = response === 'tentative' ? 'tentative' : inv.showAs;
      if (response === 'declined') {
        if (rid != null && master && sameOrganizer(master)) {
          if (!master.exdates.includes(rid)) this.save({ ...master, exdates: [...master.exdates, rid] });
          if (existing) this.remove(existing.id);
        } else if (existing) this.remove(existing.id);
      } else if (rid != null && master && sameOrganizer(master)) {
        this.saveException({ ...inv, id: existing?.id ?? inv.id, attendees, showAs }, calendarId);
        emit('calendar:changed', null);
      } else {
        this.save({ ...inv, id: existing?.id ?? inv.id, uid: found && !existing ? `${inv.uid}#${newId()}` : inv.uid, calendarId: existing?.calendarId ?? calendarId, attendees, showAs });
      }
      if (inv.organizer?.address) {
        const reply = buildIcs([{ ...inv, attendees: attendees.filter((a) => a.email.toLowerCase() === me) }], { method: 'REPLY' });
        const label = { accepted: 'Zugesagt', declined: 'Abgesagt', tentative: 'Mit Vorbehalt' }[response];
        const draft: Draft = {
          id: newId(),
          accountId: account.id,
          to: [inv.organizer],
          cc: [],
          bcc: [],
          subject: `${label}: ${inv.title}`,
          html: `<p>${escapeHtml(account.displayName || account.email)} hat die Einladung ${label.toLowerCase()}.</p>`,
          attachments: []
        };
        await this.mail.deliver(draft, { icalEvent: { method: 'REPLY', content: reply } });
      }
    }
  }

  /** Sends meeting requests to all attendees of an event */
  async sendInvites(eventId: string, accountId: string): Promise<void> {
    const ev = this.get(eventId);
    const account = this.config.getAccount(accountId);
    if (!ev || !account) throw new Error('Termin oder Konto nicht gefunden.');
    if (!ev.attendees.length) throw new Error('Der Termin hat keine Teilnehmer.');
    // Exchange sends the meeting requests itself when attendees are saved
    if (ev.remote) return;
    const organized = this.save({ ...ev, organizer: { name: account.displayName || account.name, address: account.email } });
    const when = organized.allDay
      ? new Date(organized.start).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
      : `${new Date(organized.start).toLocaleString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })} – ${new Date(organized.end).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
    const html = `<div style="font-family:Segoe UI,Arial"><h3 style="margin:0 0 8px">${escapeHtml(organized.title)}</h3><p><b>Wann:</b> ${escapeHtml(when)}<br>${organized.location ? `<b>Wo:</b> ${escapeHtml(organized.location)}<br>` : ''}${organized.onlineMeetingUrl ? `<b>Online:</b> <a href="${escapeHtml(organized.onlineMeetingUrl)}">${escapeHtml(organized.onlineMeetingUrl)}</a><br>` : ''}</p><p>${escapeHtml(organized.notes).replace(/\n/g, '<br>')}</p></div>`;
    await this.mail.deliver(
      {
        id: newId(),
        accountId,
        to: organized.attendees.map((a) => ({ name: a.name, address: a.email })),
        cc: [],
        bcc: [],
        subject: organized.title,
        html,
        attachments: []
      },
      { icalEvent: { method: 'REQUEST', content: buildIcs([organized], { method: 'REQUEST' }) } }
    );
  }

  searchText(text: string): CalendarEvent[] {
    const q = text.toLowerCase();
    return this.all()
      .filter((e) => e.title.toLowerCase().includes(q) || e.location.toLowerCase().includes(q) || e.notes.toLowerCase().includes(q))
      .slice(0, 15);
  }

  /** Next occurrence for search results */
  nextOccurrence(e: CalendarEvent): number {
    const now = Date.now();
    return expandEvent(e, now, now + 400 * 86400_000)[0]?.start ?? e.start;
  }

  exportAll(): { calendars: Calendar[]; events: CalendarEvent[] } {
    return { calendars: this.calendars(), events: this.all() };
  }

  importAll(data: { calendars: Calendar[]; events: CalendarEvent[] }): void {
    this.db.tx(() => {
      for (const c of data.calendars) this.db.run('INSERT OR REPLACE INTO calendars(id, json) VALUES(?, ?)', c.id, JSON.stringify(c));
      for (const e of data.events) this.save(e, true);
    });
    emit('calendar:changed', null);
  }
}
