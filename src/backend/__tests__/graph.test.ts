import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Db } from '../store/db';
import { CalendarService } from '../pim/calendar';
import { toLocalEvent } from '../mail/graph';
import type { ConfigStore } from '../store/config';
import type { MailService } from '../mail/service';
import { defaultAccount, defaultSettings } from '@shared/defaults';

afterEach(() => vi.unstubAllGlobals());

describe('graph event mapping', () => {
  it('maps timed and all-day events', () => {
    const timed = toLocalEvent(
      {
        id: 'e1',
        iCalUId: 'u1',
        subject: 'Meeting',
        start: { dateTime: '2026-10-01T08:00:00.0000000', timeZone: 'UTC' },
        end: { dateTime: '2026-10-01T09:30:00.0000000', timeZone: 'UTC' },
        showAs: 'tentative',
        isReminderOn: true,
        reminderMinutesBeforeStart: 10,
        attendees: [{ emailAddress: { name: 'Bob', address: 'bob@x.de' }, status: { response: 'tentativelyAccepted' } }],
        onlineMeeting: { joinUrl: 'https://teams/x' }
      },
      'cal'
    );
    expect(timed.start).toBe(Date.UTC(2026, 9, 1, 8));
    expect(timed.end - timed.start).toBe(90 * 60_000);
    expect(timed).toMatchObject({ showAs: 'tentative', reminder: 10, onlineMeetingUrl: 'https://teams/x', remote: { kind: 'graph', id: 'e1' } });
    expect(timed.attendees[0].status).toBe('tentative');
    const allDay = toLocalEvent({ id: 'e2', iCalUId: 'u2', isAllDay: true, start: { dateTime: '2026-10-02T00:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-03T00:00:00.0000000', timeZone: 'UTC' } }, 'cal');
    expect(allDay.start).toBe(new Date(2026, 9, 2).getTime());
    expect(allDay.allDay).toBe(true);
  });
});

describe('Microsoft 365 calendar sync', () => {
  it('mirrors calendars and writes new events to Exchange', async () => {
    const acc = { ...defaultAccount(), id: 'a1', email: 'me@firma.de', name: 'Firma', auth: 'oauth2' as const, oauthProvider: 'microsoft' as const };
    let settings = defaultSettings();
    const config = {
      listAccounts: () => [acc],
      getAccount: () => acc,
      getSettings: () => settings,
      updateSettings: (p: Partial<typeof settings>) => (settings = { ...settings, ...p })
    } as unknown as ConfigStore;
    const mail = { graphToken: async () => 'tok', usesGraph: () => true } as unknown as MailService;
    const events: Record<string, unknown>[] = [
      { id: 'ev1', iCalUId: 'u1', subject: 'Bestehend', start: { dateTime: '2026-10-01T08:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-10-01T09:00:00', timeZone: 'UTC' } }
    ];
    const calls: { method: string; url: string; body?: string }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ method: init.method ?? 'GET', url, body: init.body as string | undefined });
      const json = (v: unknown, status = 200): Response => new Response(JSON.stringify(v), { status });
      if (url.includes('/me/calendars?')) return json({ value: [{ id: 'C1', name: 'Kalender', isDefaultCalendar: true, canEdit: true }] });
      if (url.includes('/calendarView')) return json({ value: events });
      if (init.method === 'POST' && url.endsWith('/me/calendars/C1/events')) {
        const b = JSON.parse(init.body as string) as { subject: string; start: unknown; end: unknown };
        events.push({ id: 'ev2', iCalUId: 'u2', subject: b.subject, start: b.start, end: b.end });
        return json({ id: 'ev2' }, 201);
      }
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      return json({ error: { code: 'x', message: 'unexpected ' + url } }, 400);
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ksm-graph-'));
    const cal = new CalendarService(new Db(path.join(dir, 'g.db')), config, mail);
    expect(await cal.syncGraph('a1')).toBe(1);
    const c = cal.calendars().find((x) => x.remote);
    expect(c?.name).toBe('Kalender (Firma)');
    expect(settings.calendar.defaultCalendarId).toBe(c?.id);
    const saved = await cal.saveAny({ ...cal.get('g:ev1')!, id: '', uid: '', remote: null, title: 'Neu', calendarId: c!.id, start: Date.UTC(2026, 9, 5, 10), end: Date.UTC(2026, 9, 5, 11) });
    expect(saved.id).toBe('g:ev2');
    const post = calls.find((x) => x.method === 'POST');
    expect(JSON.parse(post!.body!).start).toEqual({ dateTime: '2026-10-05T10:00:00.000', timeZone: 'UTC' });
    await cal.removeAny('g:ev2');
    expect(calls.some((x) => x.method === 'DELETE' && x.url.endsWith('/me/events/ev2'))).toBe(true);
    expect(cal.get('g:ev2')).toBeNull();
    expect(() => cal.removeCalendar(c!.id)).toThrow(/Microsoft 365/);
  });
});

describe('sending through Microsoft Graph', () => {
  it('uses /me/sendMail with the full MIME message (incl. Bcc) instead of SMTP', async () => {
    const { MailService } = await import('../mail/service');
    const acc = { ...defaultAccount(), id: 'a2', email: 'me@firma.de', displayName: 'Ich', auth: 'oauth2' as const, oauthProvider: 'microsoft' as const };
    const settings = { ...defaultSettings(), oauth: { ...defaultSettings().oauth, microsoftClientId: 'cid' } };
    const config = {
      listAccounts: () => [acc],
      getAccount: () => acc,
      getSettings: () => settings,
      getSecret: () => ({ refreshToken: 'rt' }),
      setSecret: () => undefined
    } as unknown as ConfigStore;
    const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body), headers: init.headers as Record<string, string> });
      if (url.includes('login.microsoftonline.com')) return new Response(JSON.stringify({ access_token: 'graph-token', expires_in: 3600 }), { status: 200 });
      if (url.endsWith('/me/sendMail')) return new Response(null, { status: 202 });
      return new Response('{}', { status: 400 });
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ksm-send-'));
    const mail = new MailService(new Db(path.join(dir, 's.db')), config, dir);
    await mail.deliver({ id: 'd', accountId: 'a2', to: [{ name: 'A', address: 'a@x.de' }], cc: [], bcc: [{ name: '', address: 'geheim@x.de' }], subject: 'Test', html: '<p>Hallo</p>', attachments: [] });
    const token = calls.find((c) => c.url.includes('/token'))!;
    expect(new URLSearchParams(token.body).get('scope')).toContain('graph.microsoft.com/Mail.Send');
    const send = calls.find((c) => c.url.endsWith('/me/sendMail'))!;
    expect(send.headers.authorization).toBe('Bearer graph-token');
    const mime = Buffer.from(send.body, 'base64').toString();
    expect(mime).toMatch(/^Subject: Test/m);
    expect(mime).toMatch(/^Bcc: geheim@x\.de/m);
  });
});
