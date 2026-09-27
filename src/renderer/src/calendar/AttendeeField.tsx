// Attendee input: comma separated addresses become chips showing the response status.

import { Check, CircleHelp, Clock, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { Attendee } from '@shared/types';
import { isValidEmail, parseAddressList } from '@shared/util';
import { api } from '../api/client';

const STATUS: Record<Attendee['status'], { label: string; icon: JSX.Element }> = {
  'needs-action': { label: 'Keine Antwort', icon: <Clock size={12} /> },
  accepted: { label: 'Zugesagt', icon: <Check size={12} /> },
  declined: { label: 'Abgesagt', icon: <X size={12} /> },
  tentative: { label: 'Mit Vorbehalt', icon: <CircleHelp size={12} /> }
};

export function AttendeeField({ value, onChange }: { value: Attendee[]; onChange: (list: Attendee[]) => void }): JSX.Element {
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [suggestions, setSuggestions] = useState<{ name: string; address: string }[]>([]);
  const listId = useId();

  // address book suggestions for the current token
  useEffect(() => {
    const token = text.split(/[,;]/).pop()?.trim() ?? '';
    if (token.length < 2) {
      setSuggestions([]);
      return;
    }
    let alive = true;
    const t = window.setTimeout(() => {
      api.compose
        .suggest(token)
        .then((s) => alive && setSuggestions(s.slice(0, 8)))
        .catch(() => undefined);
    }, 150);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [text]);

  /** Moves valid addresses from the input into chips; invalid ones stay in the input */
  const commit = (raw = text): void => {
    const parsed = parseAddressList(raw);
    if (!parsed.length) return;
    const known = new Set(value.map((a) => a.email.toLowerCase()));
    const added: Attendee[] = [];
    const rest: string[] = [];
    for (const a of parsed) {
      if (!isValidEmail(a.address)) {
        rest.push(a.name ? `${a.name} <${a.address}>` : a.address);
        continue;
      }
      if (known.has(a.address.toLowerCase())) continue;
      known.add(a.address.toLowerCase());
      const suggested = suggestions.find((s) => s.address.toLowerCase() === a.address.toLowerCase());
      added.push({ name: a.name || suggested?.name || '', email: a.address, status: 'needs-action' });
    }
    if (added.length) onChange([...value, ...added]);
    setText(rest.join(', '));
    setInvalid(rest.length > 0);
  };

  return (
    <div className="col cal-attendees">
      {value.length > 0 && (
        <div className="cal-chips">
          {value.map((a) => (
            <span key={a.email} className={`chip cal-att cal-att-${a.status}`} title={`${a.name ? `${a.name} <${a.email}>` : a.email} · ${STATUS[a.status].label}`}>
              {STATUS[a.status].icon}
              <span className="ellipsis">{a.name || a.email}</span>
              <button type="button" className="cal-chip-x" aria-label={`${a.email} entfernen`} onClick={() => onChange(value.filter((x) => x !== a))}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        className={`input${invalid ? ' invalid' : ''}`}
        placeholder="Teilnehmer hinzufügen (E-Mail-Adressen, durch Komma getrennt)"
        value={text}
        list={listId}
        onChange={(e) => {
          setInvalid(false);
          const v = e.target.value;
          // a completed suggestion or a separator commits the token
          if (/[,;]\s*$/.test(v) || suggestions.some((s) => s.address === v.trim())) commit(v);
          else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Backspace' && !text && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => commit()}
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s.address} value={s.address}>
            {s.name}
          </option>
        ))}
      </datalist>
      {invalid && <span className="field-hint cal-error">Ungültige E-Mail-Adresse</span>}
    </div>
  );
}
