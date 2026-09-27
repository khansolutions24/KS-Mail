import { describe, expect, it } from 'vitest';
import { applicableRules, matchRule, type RuleSubject } from '../rules';
import { describeRecurrence, expandEvent, occurrenceStarts } from '../recurrence';
import { buildIcs, parseDate, parseDuration, parseIcs, parseRRule, formatRRule } from '../ics';
import { parseVcf, toVcf, emptyContact } from '../vcard';
import { deepMerge, formatAddress, htmlToText, isValidEmail, normalizeSubject, parseAddressList, prefixSubject } from '../util';
import type { CalendarEvent, Rule } from '../types';

const subject: RuleSubject = {
  accountId: 'a1',
  from: { name: 'Shop GmbH', address: 'rechnung@shop.de' },
  to: [{ name: 'Ich', address: 'me@example.com' }],
  cc: [],
  subject: 'Ihre Rechnung Nr. 4711',
  body: 'Betrag 12,00 €',
  hasAttachments: true,
  size: 200_000,
  headers: { 'list-id': '<news.shop.de>', importance: 'high' }
};

function rule(p: Partial<Rule>): Rule {
  return { id: 'r', name: 'r', enabled: true, accountId: null, match: 'all', conditions: [], actions: [], stopProcessing: false, ...p };
}

describe('rules', () => {
  it('matches conditions with all/any', () => {
    const all = rule({ conditions: [{ field: 'from', op: 'endsWith', value: '@shop.de' }, { field: 'subject', op: 'contains', value: 'RECHNUNG' }] });
    expect(matchRule(all, subject)).toBe(true);
    const any = rule({ match: 'any', conditions: [{ field: 'from', op: 'equals', value: 'x@y.z' }, { field: 'hasAttachment', value: 'true' }] });
    expect(matchRule(any, subject)).toBe(true);
    expect(matchRule({ ...any, match: 'all' }, subject)).toBe(false);
  });
  it('supports header, size, importance, regex and notContains', () => {
    expect(matchRule(rule({ conditions: [{ field: 'header', headerName: 'List-Id', op: 'contains', value: 'news' }] }), subject)).toBe(true);
    expect(matchRule(rule({ conditions: [{ field: 'sizeGreater', value: '100' }] }), subject)).toBe(true);
    expect(matchRule(rule({ conditions: [{ field: 'importance', value: 'high' }] }), subject)).toBe(true);
    expect(matchRule(rule({ conditions: [{ field: 'subject', op: 'regex', value: 'Nr\\.\\s*\\d+' }] }), subject)).toBe(true);
    expect(matchRule(rule({ conditions: [{ field: 'subject', op: 'regex', value: '([' }] }), subject)).toBe(false);
    expect(matchRule(rule({ conditions: [{ field: 'anyRecipient', op: 'notContains', value: 'boss@' }] }), subject)).toBe(true);
  });
  it('respects account, disabled rules and stop processing', () => {
    expect(matchRule(rule({ accountId: 'other' }), subject)).toBe(false);
    expect(matchRule(rule({ enabled: false }), subject)).toBe(false);
    const hits = applicableRules([rule({ id: '1', stopProcessing: true }), rule({ id: '2' })], subject);
    expect(hits.map((r) => r.id)).toEqual(['1']);
  });
});

describe('recurrence', () => {
  const start = new Date(2026, 0, 5, 9, 0).getTime(); // Monday
  it('expands weekly with weekdays and count', () => {
    const list = [...occurrenceStarts(start, { freq: 'WEEKLY', interval: 1, byDay: [1, 3, 5], count: 5 })];
    expect(list.map((t) => new Date(t).getDate())).toEqual([5, 7, 9, 12, 14]);
  });
  it('skips invalid monthly dates', () => {
    const jan31 = new Date(2026, 0, 31, 10).getTime();
    const list = [...occurrenceStarts(jan31, { freq: 'MONTHLY', interval: 1, count: 3 })];
    expect(list.map((t) => new Date(t).getMonth())).toEqual([0, 2, 4]);
  });
  it('honours until and exdates in expansion', () => {
    const ev = { start, end: start + 3600_000, recurrence: { freq: 'DAILY', interval: 1, until: start + 4 * 86400_000 }, exdates: [start + 86400_000] } as CalendarEvent;
    const occ = expandEvent(ev, start, start + 30 * 86400_000);
    expect(occ.length).toBe(4);
    expect(describeRecurrence(ev.recurrence)).toContain('Täglich');
  });
});

describe('ics', () => {
  it('parses dates, durations and rrules', () => {
    expect(parseDate('20260101T120000Z')?.ms).toBe(Date.UTC(2026, 0, 1, 12));
    expect(parseDate('20260101', { VALUE: 'DATE' })?.allDay).toBe(true);
    const berlin = parseDate('20260701T100000', { TZID: 'W. Europe Standard Time' })!;
    expect(berlin.ms).toBe(Date.UTC(2026, 6, 1, 8));
    expect(parseDuration('PT1H30M')).toBe(5400_000);
    expect(parseDuration('-PT15M')).toBe(-900_000);
    const r = parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10')!;
    expect(r).toMatchObject({ freq: 'WEEKLY', interval: 2, byDay: [1, 3], count: 10 });
    expect(formatRRule(r)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10');
  });
  it('round-trips events', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'UID:abc@x',
      'DTSTART:20261001T080000Z',
      'DURATION:PT45M',
      'SUMMARY:Planung\\, Q4',
      'LOCATION:Raum 2',
      'DESCRIPTION:Zeile 1\\nZeile 2',
      'ORGANIZER;CN="Müller, Anna":mailto:anna@x.de',
      'ATTENDEE;CN=Bob;PARTSTAT=ACCEPTED:mailto:bob@x.de',
      'BEGIN:VALARM',
      'TRIGGER:-PT15M',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');
    const { method, events } = parseIcs(ics, 'cal');
    expect(method).toBe('REQUEST');
    const e = events[0];
    expect(e.title).toBe('Planung, Q4');
    expect(e.notes).toBe('Zeile 1\nZeile 2');
    expect(e.end - e.start).toBe(45 * 60_000);
    expect(e.reminder).toBe(15);
    expect(e.organizer).toEqual({ name: 'Müller, Anna', address: 'anna@x.de' });
    expect(e.attendees[0].status).toBe('accepted');
    const again = parseIcs(buildIcs([e], { method: 'REPLY' }), 'cal').events[0];
    expect(again).toMatchObject({ uid: 'abc@x', title: e.title, notes: e.notes, start: e.start, end: e.end, reminder: 15, location: 'Raum 2' });
  });
});

describe('vcard', () => {
  it('round-trips contacts', () => {
    const c = { ...emptyContact(), firstName: 'Anna', lastName: 'Schmidt', displayName: 'Anna Schmidt', company: 'ACME; GmbH', emails: [{ label: 'Geschäftlich', value: 'anna@acme.de' }], phones: [{ label: 'Mobil', value: '+49 170 1234567' }], birthday: '1990-04-01', notes: 'a,b\nc', address: { street: 'Hauptstr. 1', zip: '10115', city: 'Berlin', country: 'DE' } };
    const back = parseVcf(toVcf([c]))[0];
    expect(back).toMatchObject({ firstName: 'Anna', lastName: 'Schmidt', company: 'ACME; GmbH', birthday: '1990-04-01', notes: 'a,b\nc' });
    expect(back.emails[0]).toEqual({ label: 'Geschäftlich', value: 'anna@acme.de' });
    expect(back.phones[0].label).toBe('Mobil');
    expect(back.address.city).toBe('Berlin');
  });
});

describe('util', () => {
  it('parses and formats address lists', () => {
    expect(parseAddressList('"Müller, Anna" <anna@x.de>; bob@y.de, Carl <c@z.de>')).toEqual([
      { name: 'Müller, Anna', address: 'anna@x.de' },
      { name: '', address: 'bob@y.de' },
      { name: 'Carl', address: 'c@z.de' }
    ]);
    expect(formatAddress({ name: 'Müller, Anna', address: 'anna@x.de' })).toBe('"Müller, Anna" <anna@x.de>');
    expect(isValidEmail('a@b.de')).toBe(true);
    expect(isValidEmail('a@b')).toBe(false);
  });
  it('handles subjects and html', () => {
    expect(normalizeSubject('AW: WG: Re: Hallo')).toBe('hallo');
    expect(prefixSubject('AW', 'Re: Hallo')).toBe('Re: Hallo');
    expect(prefixSubject('WG', 'Hallo')).toBe('WG: Hallo');
    expect(htmlToText('<p>Hallo&nbsp;<b>Welt</b></p><script>x()</script><ul><li>eins</li></ul>')).toBe('Hallo Welt\n• eins');
  });
  it('deep merges settings objects but replaces arrays', () => {
    const r = deepMerge({ a: { b: 1, c: 2 }, list: [1, 2] }, { a: { c: 3 }, list: [9] });
    expect(r).toEqual({ a: { b: 1, c: 3 }, list: [9] });
  });
});
