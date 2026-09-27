// Event editor dialog (new and existing events, occurrences of series, read-only subscriptions).

import clsx from 'clsx';
import { ExternalLink, Send, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CalendarEvent } from '@shared/types';
import { api } from '../api/client';
import { attempt, useApp } from '../store/app';
import { Button, Checkbox, Dialog, Field, IconButton, Switch } from '../components/ui';
import { addDays, fromInputs, minutesLabel, REMINDER_OPTIONS, startOfDay, toInputDate, toInputTime } from '../lib/format';
import { deleteOccurrence, saveFromEditor, UNTITLED } from './actions';
import { AttendeeField } from './AttendeeField';
import { atMinutes, ceilToMinutes, dayDiff, MINUTE_MS } from './dates';
import { SHOW_AS_LABELS } from './EventParts';
import { RecurrenceEditor } from './RecurrenceEditor';
import { calSettings, isWritableCalendar, useCalendar, type EditorState } from './store';

export function EventEditor(): JSX.Element | null {
  const state = useCalendar((s) => s.editor);
  if (!state) return null;
  // remount per opened event so the local draft starts fresh
  return <EditorDialog key={`${state.original?.id ?? 'new'}:${state.occurrenceStart ?? state.event.start}`} state={state} />;
}

/** Last day (inclusive) of an all-day event whose end is exclusive midnight */
function lastDay(ev: CalendarEvent): number {
  return startOfDay(Math.max(ev.start, ev.end - 1));
}

function EditorDialog({ state }: { state: EditorState }): JSX.Element {
  const close = useCalendar((s) => s.closeEditor);
  const calendars = useCalendar((s) => s.calendars);
  const categories = useApp((s) => s.settings?.categories ?? []);
  const accounts = useApp((s) => s.accounts);
  const defaultAccountId = useApp((s) => s.settings?.defaultAccountId ?? null);
  const [ev, setEv] = useState<CalendarEvent>(state.event);
  const [busy, setBusy] = useState(false);
  const usableAccounts = useMemo(() => accounts.filter((a) => a.enabled), [accounts]);
  const [accountId, setAccountId] = useState(() => (usableAccounts.find((a) => a.id === defaultAccountId) ?? usableAccounts[0])?.id ?? '');

  const isNew = !state.original;
  const cal = calendars.find((c) => c.id === ev.calendarId);
  const readOnly = !!cal && !isWritableCalendar(cal);
  const patch = (p: Partial<CalendarEvent>): void => setEv((cur) => ({ ...cur, ...p }));
  // all-day ends are exclusive (midnight after the last day)
  const invalid = ev.allDay ? ev.end <= ev.start : ev.end < ev.start;

  // ── date / time handling: changing the start keeps the duration ──
  const setStart = (start: number): void =>
    setEv((cur) => ({ ...cur, start, end: cur.allDay ? addDays(start, Math.max(1, dayDiff(cur.start, cur.end))) : start + (cur.end - cur.start) }));
  const setStartDate = (v: string): void => {
    if (v) setStart(ev.allDay ? fromInputs(v) : fromInputs(v, toInputTime(ev.start)));
  };
  const setStartTime = (v: string): void => {
    if (v) setStart(fromInputs(toInputDate(ev.start), v));
  };
  const setEndDate = (v: string): void => {
    if (v) patch({ end: ev.allDay ? addDays(fromInputs(v), 1) : fromInputs(v, toInputTime(ev.end)) });
  };
  const setEndTime = (v: string): void => {
    if (v) patch({ end: fromInputs(toInputDate(ev.end), v) });
  };
  const setAllDay = (allDay: boolean): void => {
    if (allDay) {
      const start = startOfDay(ev.start);
      patch({ allDay, start, end: addDays(lastDay(ev), 1) });
    } else {
      const day = startOfDay(ev.start);
      const start = day === startOfDay(Date.now()) ? ceilToMinutes(Date.now(), 30) : atMinutes(day, 9 * 60);
      patch({ allDay, start, end: start + calSettings().defaultDuration * MINUTE_MS });
    }
  };

  const save = async (invite: boolean): Promise<void> => {
    if (invalid || busy || readOnly) return;
    setBusy(true);
    const saved = await saveFromEditor(state, ev, invite ? accountId : undefined);
    setBusy(false);
    if (!saved) return;
    close();
    useCalendar.getState().select({ id: saved.id, start: state.occurrenceStart !== undefined && saved.recurrence ? ev.start : saved.start });
  };

  const remove = async (): Promise<void> => {
    if (!state.original) return;
    if (await deleteOccurrence(state.original, state.occurrenceStart ?? state.original.start)) close();
  };

  const reminderOptions = ev.reminder != null && !REMINDER_OPTIONS.includes(ev.reminder) ? [...REMINDER_OPTIONS, ev.reminder].sort((a, b) => a - b) : REMINDER_OPTIONS;
  const selectableCalendars = calendars.filter((c) => isWritableCalendar(c) || c.id === ev.calendarId);
  const canInvite = ev.attendees.length > 0 && !readOnly;
  const meetingUrl = /^https?:\/\/\S+$/i.test(ev.onlineMeetingUrl.trim()) ? ev.onlineMeetingUrl.trim() : '';

  const footer = readOnly ? (
    <Button onClick={close}>Schließen</Button>
  ) : (
    <>
      {!isNew && (
        <Button variant="subtle" className="cal-delete-btn" icon={<Trash2 size={16} />} onClick={() => void remove()} disabled={busy}>
          Löschen
        </Button>
      )}
      <span className="grow" />
      <Button onClick={close}>Abbrechen</Button>
      <Button variant={canInvite ? undefined : 'primary'} onClick={() => void save(false)} disabled={invalid || busy}>
        Speichern
      </Button>
      {canInvite && (
        <Button variant="primary" icon={<Send size={16} />} onClick={() => void save(true)} disabled={invalid || busy || !accountId} title={accountId ? undefined : 'Kein E-Mail-Konto vorhanden'}>
          Speichern &amp; Einladungen senden
        </Button>
      )}
    </>
  );

  return (
    <Dialog open onClose={close} width={640} title={isNew ? 'Neuer Termin' : readOnly ? 'Termin' : state.original?.recurrence ? 'Serientermin bearbeiten' : 'Termin bearbeiten'} footer={footer}>
      <form
        className="cal-editor"
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'Enter')) {
            e.preventDefault();
            void save(false);
          }
        }}
      >
        {readOnly && <div className="cal-readonly-note">Dieser Termin stammt aus einem abonnierten Internetkalender und kann nicht bearbeitet werden.</div>}
        <fieldset className="cal-fieldset" disabled={readOnly}>
          <input
            className="input cal-title-input"
            autoFocus={!readOnly}
            placeholder={`Titel hinzufügen – ${UNTITLED}`}
            aria-label="Titel"
            value={ev.title}
            onChange={(e) => patch({ title: e.target.value })}
          />

          <div className="cal-form-grid">
            <Field label="Kalender">
              <div className="row">
                <span className="color-dot" style={{ background: calendars.find((c) => c.id === ev.calendarId)?.color }} />
                <select className="select grow" value={ev.calendarId} onChange={(e) => patch({ calendarId: e.target.value })}>
                  {selectableCalendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Field label="Anzeigen als">
              <select className="select" value={ev.showAs} onChange={(e) => patch({ showAs: e.target.value as CalendarEvent['showAs'] })}>
                {(Object.keys(SHOW_AS_LABELS) as CalendarEvent['showAs'][]).map((k) => (
                  <option key={k} value={k}>
                    {SHOW_AS_LABELS[k]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Ort">
            <input className="input" value={ev.location} onChange={(e) => patch({ location: e.target.value })} placeholder="Ort oder Raum" />
          </Field>
          <Field label="Online-Besprechungs-Link">
            <div className="row">
              <input className="input grow" type="url" value={ev.onlineMeetingUrl} onChange={(e) => patch({ onlineMeetingUrl: e.target.value })} placeholder="https://…" />
              {meetingUrl && (
                <IconButton label="Link öffnen" type="button" onClick={() => void attempt(() => api.app.openExternal(meetingUrl))}>
                  <ExternalLink size={16} />
                </IconButton>
              )}
            </div>
          </Field>

          <div className="cal-when">
            <div className="cal-when-row">
              <span className="field-label">Beginn</span>
              <input className="input" type="date" value={toInputDate(ev.start)} onChange={(e) => setStartDate(e.target.value)} aria-label="Startdatum" />
              {!ev.allDay && <input className="input" type="time" step={300} value={toInputTime(ev.start)} onChange={(e) => setStartTime(e.target.value)} aria-label="Startzeit" />}
              <Switch checked={ev.allDay} onChange={setAllDay} label="Ganztägig" />
            </div>
            <div className="cal-when-row">
              <span className="field-label">Ende</span>
              <input className={clsx('input', invalid && 'invalid')} type="date" value={toInputDate(ev.allDay ? lastDay(ev) : ev.end)} onChange={(e) => setEndDate(e.target.value)} aria-label="Enddatum" />
              {!ev.allDay && <input className={clsx('input', invalid && 'invalid')} type="time" step={300} value={toInputTime(ev.end)} onChange={(e) => setEndTime(e.target.value)} aria-label="Endzeit" />}
              {invalid && <span className="cal-error">Das Ende liegt vor dem Beginn.</span>}
            </div>
          </div>

          <Field label="Wiederholung">
            <RecurrenceEditor value={ev.recurrence} start={ev.start} weekStart={calSettings().weekStart} onChange={(recurrence) => patch({ recurrence })} />
          </Field>

          <div className="cal-form-grid">
            <Field label="Erinnerung">
              <select className="select" value={ev.reminder ?? ''} onChange={(e) => patch({ reminder: e.target.value === '' ? null : Number(e.target.value) })}>
                <option value="">Keine</option>
                {reminderOptions.map((m) => (
                  <option key={m} value={m}>
                    {minutesLabel(m)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Vertraulichkeit">
              <div className="cal-private">
                <Checkbox checked={ev.isPrivate} onChange={(isPrivate) => patch({ isPrivate })} label="Privat" />
              </div>
            </Field>
          </div>

          {categories.length > 0 && (
            <Field label="Kategorien">
              <div className="cal-chips">
                {categories.map((c) => {
                  const on = ev.categories.includes(c.name);
                  return (
                    <button
                      key={c.name}
                      type="button"
                      className={clsx('cal-cat', on && 'on')}
                      style={{ ['--cat' as string]: c.color }}
                      aria-pressed={on}
                      onClick={() => patch({ categories: on ? ev.categories.filter((x) => x !== c.name) : [...ev.categories, c.name] })}
                    >
                      <span className="cal-cat-dot" />
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          <Field label="Teilnehmer">
            <AttendeeField value={ev.attendees} onChange={(attendees) => patch({ attendees })} />
          </Field>
          {canInvite && (
            <Field label="Einladungen senden von">
              <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {usableAccounts.length === 0 && <option value="">Kein Konto vorhanden</option>}
                {usableAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name ? `${a.name} – ${a.email}` : a.email}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Notizen">
            <textarea className="textarea" rows={5} value={ev.notes} onChange={(e) => patch({ notes: e.target.value })} />
          </Field>
        </fieldset>
      </form>
    </Dialog>
  );
}
