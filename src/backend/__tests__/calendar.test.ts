import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Db } from '../store/db';
import { CalendarService } from '../pim/calendar';
import type { ConfigStore } from '../store/config';
import type { MailService } from '../mail/service';
import { sanitizeHtml } from '../mail/parse';
import { deepMerge } from '@shared/util';

function service(): CalendarService {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ksm-cal-'));
  return new CalendarService(new Db(path.join(dir, 'c.db')), {} as ConfigStore, {} as MailService);
}

const ICS = (extra: string) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', extra, 'END:VCALENDAR'].join('\r\n');

describe('calendar import with exceptions', () => {
  it('keeps the series and stores RECURRENCE-ID overrides separately', () => {
    const cal = service();
    const exception = ['BEGIN:VEVENT', 'UID:s1', 'RECURRENCE-ID:20261007T080000Z', 'DTSTART:20261007T120000Z', 'DTEND:20261007T130000Z', 'SUMMARY:Weekly (verschoben)', 'END:VEVENT'].join('\r\n');
    const master = ['BEGIN:VEVENT', 'UID:s1', 'DTSTART:20260930T080000Z', 'DTEND:20260930T090000Z', 'RRULE:FREQ=WEEKLY;COUNT=4', 'SUMMARY:Weekly', 'END:VEVENT'].join('\r\n');
    // exception listed before the master on purpose
    expect(cal.importText('default', ICS(exception + '\r\n' + master))).toBe(2);
    const occ = cal.occurrences(Date.UTC(2026, 8, 29), Date.UTC(2026, 9, 30));
    expect(occ.map((o) => o.event.title)).toEqual(['Weekly', 'Weekly (verschoben)', 'Weekly', 'Weekly']);
    expect(occ[1].start).toBe(Date.UTC(2026, 9, 7, 12));
    // re-import is idempotent
    cal.importText('default', ICS(master + '\r\n' + exception));
    expect(cal.occurrences(Date.UTC(2026, 8, 29), Date.UTC(2026, 9, 30)).length).toBe(4);
  });
});

describe('fixes', () => {
  it('deepMerge lets settings be cleared with null', () => {
    expect(deepMerge({ a: { b: 5 as number | null }, id: 'x' as string | null }, { a: { b: null }, id: null })).toEqual({ a: { b: null }, id: null });
  });
  it('sanitizer cannot be tricked by nested tags', () => {
    const out = sanitizeHtml('<me<base>ta http-equiv="refresh" content="0;url=https://evil"><link rel=prefetch href="https://x" title="stylesheet">ok');
    expect(out).not.toMatch(/<meta|<link/i);
    expect(out).toContain('ok');
  });
});
