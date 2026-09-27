// "Automatische Antworten", "Kalender" and "Benachrichtigungen".

import clsx from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Calendar, Settings } from '@shared/types';
import { api } from '../api/client';
import { IconButton, Switch } from '../components/ui';
import { Card, Page, Row, Segmented, Select, TextArea, TextInput, patchGroup, type Opt, type SectionProps } from './common';

const pad = (n: number): string => String(n).padStart(2, '0');

/** ms → value for <input type="datetime-local"> */
function toLocalInput(ms: number | null): string {
  if (ms == null) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(s: string): number | null {
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? null : t;
}

function DateTimeInput({ value, onChange }: { value: number | null; onChange: (ms: number | null) => void }): JSX.Element {
  return (
    <span className="row">
      <input className="input" type="datetime-local" value={toLocalInput(value)} onChange={(e) => onChange(fromLocalInput(e.target.value))} />
      {value != null && (
        <IconButton small label="Leeren" onClick={() => onChange(null)}>
          <X size={14} />
        </IconButton>
      )}
    </span>
  );
}

function TimeInput({ value, onChange, clearable }: { value: string; onChange: (v: string) => void; clearable?: boolean }): JSX.Element {
  return (
    <span className="row">
      <input className="input" type="time" value={value} onChange={(e) => (e.target.value || clearable ? onChange(e.target.value) : undefined)} style={{ width: 120 }} />
      {clearable && value && (
        <IconButton small label="Leeren" onClick={() => onChange('')}>
          <X size={14} />
        </IconButton>
      )}
    </span>
  );
}

// ─── out of office ───

export function OutOfOfficeSection({ settings }: SectionProps): JSX.Element {
  const o = settings.outOfOffice;
  const set = (patch: Partial<Settings['outOfOffice']>): void => void patchGroup('outOfOffice', patch);
  const rangeError = o.from != null && o.to != null && o.to <= o.from;
  const now = Date.now();
  const active = o.enabled && (o.from == null || o.from <= now) && (o.to == null || o.to > now);

  return (
    <Page title="Automatische Antworten" description="Beantwortet eingehende Nachrichten automatisch, z. B. während Ihres Urlaubs.">
      <Card>
        <Row label="Automatische Antworten senden" hint={o.enabled ? (active ? 'Derzeit aktiv' : 'Eingeschaltet – außerhalb des Zeitraums') : 'Ausgeschaltet'}>
          <Switch checked={o.enabled} onChange={(enabled) => set({ enabled })} />
        </Row>
        <div className={clsx('st-hint small-text', active && 'active')}>
          Die Antworten werden von KS Mail gesendet, solange die App läuft – auch minimiert im Infobereich. Ist KS Mail beendet, werden keine automatischen Antworten verschickt. Jeder Absender erhält pro Zeitraum nur eine Antwort; Newsletter und automatisch erzeugte Nachrichten werden nicht beantwortet.
        </div>
      </Card>
      <Card title="Zeitraum" description="Optional – ohne Zeitraum gelten die Antworten, bis Sie sie ausschalten.">
        <Row label="Beginn">
          <DateTimeInput value={o.from} onChange={(from) => set({ from })} />
        </Row>
        <Row label="Ende">
          <DateTimeInput value={o.to} onChange={(to) => set({ to })} />
        </Row>
        {rangeError && <div className="st-error small-text">Das Ende muss nach dem Beginn liegen.</div>}
      </Card>
      <Card title="Nachricht">
        <Row label="Betreff" stacked>
          <TextInput value={o.subject} onCommit={(subject) => set({ subject })} placeholder="Abwesenheitsnotiz" />
        </Row>
        <Row label="Text" stacked>
          <TextArea value={o.text} onCommit={(text) => set({ text })} rows={8} placeholder={'Vielen Dank für Ihre Nachricht. Ich bin bis zum … nicht im Büro und habe keinen Zugriff auf meine E-Mails.\nIn dringenden Fällen wenden Sie sich bitte an …'} />
        </Row>
        <Row label="Nur an meine Kontakte antworten" hint="Absender, die nicht in Ihren Kontakten stehen, erhalten keine Antwort">
          <Switch checked={o.onlyContacts} onChange={(onlyContacts) => set({ onlyContacts })} />
        </Row>
      </Card>
    </Page>
  );
}

// ─── calendar ───

const WEEKDAYS: { day: number; label: string }[] = [
  { day: 1, label: 'Mo' },
  { day: 2, label: 'Di' },
  { day: 3, label: 'Mi' },
  { day: 4, label: 'Do' },
  { day: 5, label: 'Fr' },
  { day: 6, label: 'Sa' },
  { day: 0, label: 'So' }
];

const REMINDERS: Opt<number | null>[] = [
  { value: null, label: 'Keine' },
  { value: 0, label: 'Zu Beginn' },
  { value: 5, label: '5 Minuten vorher' },
  { value: 10, label: '10 Minuten vorher' },
  { value: 15, label: '15 Minuten vorher' },
  { value: 30, label: '30 Minuten vorher' },
  { value: 60, label: '1 Stunde vorher' },
  { value: 120, label: '2 Stunden vorher' },
  { value: 1440, label: '1 Tag vorher' },
  { value: 10080, label: '1 Woche vorher' }
];

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];

export function CalendarSection({ settings }: SectionProps): JSX.Element {
  const c = settings.calendar;
  const set = (patch: Partial<Settings['calendar']>): void => void patchGroup('calendar', patch);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  useEffect(() => {
    api.calendar
      .calendars()
      .then(setCalendars)
      .catch(() => setCalendars([]));
  }, []);

  const reminders = REMINDERS.some((r) => r.value === c.defaultReminder) ? REMINDERS : [...REMINDERS, { value: c.defaultReminder, label: `${c.defaultReminder} Minuten vorher` }];
  const durations = DURATIONS.includes(c.defaultDuration) ? DURATIONS : [...DURATIONS, c.defaultDuration].sort((a, b) => a - b);
  const toggleDay = (d: number): void => {
    const next = c.workDays.includes(d) ? c.workDays.filter((x) => x !== d) : [...c.workDays, d].sort((a, b) => a - b);
    set({ workDays: next });
  };
  const hoursError = c.workStart && c.workEnd && c.workEnd <= c.workStart;

  return (
    <Page title="Kalender" description="Arbeitszeit, Ansicht und Standardwerte für neue Termine.">
      <Card title="Arbeitszeit">
        <Row label="Erster Tag der Woche">
          <Select<Settings['calendar']['weekStart']>
            value={c.weekStart}
            options={[
              { value: 1, label: 'Montag' },
              { value: 0, label: 'Sonntag' },
              { value: 6, label: 'Samstag' }
            ]}
            onChange={(weekStart) => set({ weekStart })}
          />
        </Row>
        <Row label="Arbeitstage" hint="Werden in der Arbeitswochenansicht angezeigt">
          <div className="st-days">
            {WEEKDAYS.map((w) => (
              <button key={w.day} type="button" className={clsx('st-day', c.workDays.includes(w.day) && 'active')} aria-pressed={c.workDays.includes(w.day)} onClick={() => toggleDay(w.day)}>
                {w.label}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Arbeitszeit">
          <span className="row">
            <TimeInput value={c.workStart} onChange={(workStart) => set({ workStart })} />
            <span className="muted">bis</span>
            <TimeInput value={c.workEnd} onChange={(workEnd) => set({ workEnd })} />
          </span>
        </Row>
        {hoursError && <div className="st-error small-text">Das Ende der Arbeitszeit muss nach dem Beginn liegen.</div>}
      </Card>

      <Card title="Ansicht">
        <Row label="Standardansicht">
          <Select<Settings['calendar']['defaultView']>
            value={c.defaultView}
            options={[
              { value: 'day', label: 'Tag' },
              { value: 'workweek', label: 'Arbeitswoche' },
              { value: 'week', label: 'Woche' },
              { value: 'month', label: 'Monat' },
              { value: 'agenda', label: 'Agenda' }
            ]}
            onChange={(defaultView) => set({ defaultView })}
          />
        </Row>
        <Row label="Zeitskala" hint="Höhe eines Rasterabschnitts in Tages- und Wochenansicht">
          <Segmented<Settings['calendar']['timeScale']>
            value={c.timeScale}
            onChange={(timeScale) => set({ timeScale })}
            options={[
              { value: 15, label: '15 Min.' },
              { value: 30, label: '30 Min.' },
              { value: 60, label: '60 Min.' }
            ]}
          />
        </Row>
        <Row label="Kalenderwochen anzeigen">
          <Switch checked={c.showWeekNumbers} onChange={(showWeekNumbers) => set({ showWeekNumbers })} />
        </Row>
      </Card>

      <Card title="Neue Termine">
        <Row label="Standardkalender">
          <Select<string | null> value={c.defaultCalendarId} options={[{ value: null, label: '(Erster Kalender)' }, ...calendars.filter((x) => !x.subscriptionUrl && (!x.remote || x.remote.canEdit)).map((x) => ({ value: x.id, label: x.name }))]} onChange={(defaultCalendarId) => set({ defaultCalendarId })} />
        </Row>
        <Row label="Standarderinnerung">
          <Select value={c.defaultReminder} options={reminders} onChange={(defaultReminder) => set({ defaultReminder })} />
        </Row>
        <Row label="Standarddauer">
          <Select value={c.defaultDuration} options={durations.map((d) => ({ value: d, label: d < 60 ? `${d} Minuten` : d % 60 === 0 ? `${d / 60} Stunde${d === 60 ? '' : 'n'}` : `${Math.floor(d / 60)}:${pad(d % 60)} Stunden` }))} onChange={(defaultDuration) => set({ defaultDuration })} />
        </Row>
      </Card>
    </Page>
  );
}

// ─── notifications ───

export function NotificationsSection({ settings }: SectionProps): JSX.Element {
  const n = settings.notifications;
  const set = (patch: Partial<Settings['notifications']>): void => void patchGroup('notifications', patch);
  const quiet = !!(n.quietHoursFrom && n.quietHoursTo);

  return (
    <Page title="Benachrichtigungen" description="Hinweise zu neuen Nachrichten und Erinnerungen.">
      <Card>
        <Row label="Desktopbenachrichtigungen anzeigen">
          <Switch checked={n.enabled} onChange={(enabled) => set({ enabled })} />
        </Row>
        <Row label="Ton abspielen">
          <Switch checked={n.sound} onChange={(sound) => set({ sound })} disabled={!n.enabled} />
        </Row>
        <Row label="Vorschau anzeigen" hint="Absender und Betreff in der Benachrichtigung – aus für mehr Privatsphäre">
          <Switch checked={n.showPreview} onChange={(showPreview) => set({ showPreview })} disabled={!n.enabled} />
        </Row>
        <Row label="Nur für den Posteingang" hint="Keine Benachrichtigungen für Nachrichten, die per Regel in andere Ordner verschoben wurden">
          <Switch checked={n.onlyInbox} onChange={(onlyInbox) => set({ onlyInbox })} disabled={!n.enabled} />
        </Row>
        <Row label="Anzahl ungelesener Nachrichten am App-Symbol">
          <Switch checked={n.badge} onChange={(badge) => set({ badge })} />
        </Row>
      </Card>
      <Card title="Ruhezeiten" description="In diesem Zeitraum werden keine Benachrichtigungen angezeigt und keine Töne abgespielt. Leer = keine Ruhezeiten.">
        <Row label="Von">
          <TimeInput value={n.quietHoursFrom} clearable onChange={(quietHoursFrom) => set({ quietHoursFrom })} />
        </Row>
        <Row label="Bis">
          <TimeInput value={n.quietHoursTo} clearable onChange={(quietHoursTo) => set({ quietHoursTo })} />
        </Row>
        {(n.quietHoursFrom || n.quietHoursTo) && !quiet && <div className="st-warning small-text">Bitte Beginn und Ende angeben, damit die Ruhezeiten gelten.</div>}
        {quiet && <div className="muted small-text">Ruhezeiten täglich von {n.quietHoursFrom} bis {n.quietHoursTo} Uhr.</div>}
      </Card>
    </Page>
  );
}
