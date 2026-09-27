// Shared building blocks for the settings pages: layout (Page/Card/Row), inputs that commit on blur
// or after a short pause (so typing does not trigger one backend round-trip per key), and patch helpers.

import clsx from 'clsx';
import { Plus, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import type { Settings } from '@shared/types';
import { useApp } from '../store/app';
import { Button, IconButton } from '../components/ui';

export interface SectionProps {
  settings: Settings;
}

type Group = 'mail' | 'notifications' | 'calendar' | 'outOfOffice' | 'oauth';

/** Patches top-level settings (optimistic, errors are reported as toast by the store) */
export function update(patch: Partial<Settings>): Promise<void> {
  return useApp.getState().updateSettings(patch);
}

/** Patches one nested settings group; always merges into the latest state to avoid stale closures */
export function patchGroup<K extends Group>(key: K, patch: Partial<Settings[K]>): Promise<void> {
  const s = useApp.getState().settings;
  if (!s) return Promise.resolve();
  const next: Partial<Settings> = {};
  (next as Record<K, Settings[K]>)[key] = { ...s[key], ...patch };
  return useApp.getState().updateSettings(next);
}

// ─── layout ───

export function Page({ title, description, actions, children }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="st-page">
      <header className="st-page-header">
        <div className="grow">
          <h1>{title}</h1>
          {description && <p className="muted">{description}</p>}
        </div>
        {actions && <div className="row st-page-actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function Card({ title, description, actions, children, flush }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean }): JSX.Element {
  return (
    <section className="st-card">
      {(title || actions) && (
        <header className="st-card-header">
          <div className="grow">
            {title && <h2>{title}</h2>}
            {description && <p className="muted small-text">{description}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      <div className={clsx('st-card-body', flush && 'flush')}>{children}</div>
    </section>
  );
}

/** One setting: label (+ hint) on the left, control on the right */
export function Row({ label, hint, children, stacked }: { label: ReactNode; hint?: ReactNode; children: ReactNode; stacked?: boolean }): JSX.Element {
  return (
    <div className={clsx('st-row', stacked && 'stacked')}>
      <div className="st-row-label">
        <div>{label}</div>
        {hint && <div className="st-row-hint">{hint}</div>}
      </div>
      <div className="st-row-control">{children}</div>
    </div>
  );
}

// ─── inputs ───

/** Local draft for a committed string value: commits after `delay` ms of inactivity, on blur and on unmount */
function useDraft(value: string, onCommit: (v: string) => void, delay: number) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef({ draft: value, committed: value, onCommit });
  latest.current.onCommit = onCommit;

  useEffect(() => {
    latest.current.committed = value;
    // never overwrite what the user is typing with an (older) round-tripped value
    if (!focused.current) {
      latest.current.draft = value;
      setDraft(value);
    }
  }, [value]);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const l = latest.current;
    if (l.draft !== l.committed) {
      l.committed = l.draft;
      l.onCommit(l.draft);
    }
  }, []);

  useEffect(() => () => flush(), [flush]);

  const change = (v: string): void => {
    setDraft(v);
    latest.current.draft = v;
    window.clearTimeout(timer.current);
    if (delay > 0) timer.current = window.setTimeout(flush, delay);
  };

  return {
    draft,
    change,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      flush();
    }
  };
}

type InputBase = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'defaultValue'>;

export function TextInput({ value, onCommit, delay = 600, className, ...rest }: InputBase & { value: string; onCommit: (v: string) => void; delay?: number }): JSX.Element {
  const d = useDraft(value, onCommit, delay);
  return (
    <input
      {...rest}
      className={clsx('input', className)}
      value={d.draft}
      onChange={(e) => d.change(e.target.value)}
      onFocus={d.onFocus}
      onBlur={d.onBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        rest.onKeyDown?.(e);
      }}
    />
  );
}

type AreaBase = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'defaultValue'>;

export function TextArea({ value, onCommit, delay = 800, className, ...rest }: AreaBase & { value: string; onCommit: (v: string) => void; delay?: number }): JSX.Element {
  const d = useDraft(value, onCommit, delay);
  return <textarea {...rest} className={clsx('textarea', className)} value={d.draft} onChange={(e) => d.change(e.target.value)} onFocus={d.onFocus} onBlur={d.onBlur} />;
}

/** Number input that clamps to [min, max] and commits on blur / Enter */
export function NumberInput({ value, onCommit, min, max, step = 1, width = 90, suffix }: { value: number; onCommit: (n: number) => void; min: number; max: number; step?: number; width?: number; suffix?: string }): JSX.Element {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (): void => {
    const n = Number(draft.replace(',', '.'));
    if (!Number.isFinite(n) || draft.trim() === '') {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, step >= 1 ? Math.round(n) : n));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <span className="row st-number">
      <input
        className="input"
        type="number"
        style={{ width }}
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      {suffix && <span className="muted">{suffix}</span>}
    </span>
  );
}

export interface Opt<T> {
  value: T;
  label: string;
}

/** Typed <select>; values are compared by their string form */
export function Select<T extends string | number | null>({ value, options, onChange, style, className, disabled }: { value: T; options: Opt<T>[]; onChange: (v: T) => void; style?: CSSProperties; className?: string; disabled?: boolean }): JSX.Element {
  return (
    <select
      className={clsx('select', className)}
      style={style}
      disabled={disabled}
      value={String(value)}
      onChange={(e) => {
        const o = options.find((x) => String(x.value) === e.target.value);
        if (o) onChange(o.value);
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Segmented button group for small enumerations */
export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: (Opt<T> & { icon?: ReactNode })[]; onChange: (v: T) => void }): JSX.Element {
  return (
    <div className="st-seg" role="radiogroup">
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} className={clsx('st-seg-btn', o.value === value && 'active')} onClick={() => onChange(o.value)}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Range slider with a local value; commits shortly after the user stops dragging */
export function Slider({ value, min, max, step = 1, onCommit, format }: { value: number; min: number; max: number; step?: number; onCommit: (n: number) => void; format?: (n: number) => string }): JSX.Element {
  const [v, setV] = useState(value);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => setV(value), [value]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <span className="row st-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => {
          const n = Number(e.target.value);
          setV(n);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => onCommit(n), 250);
        }}
      />
      <span className="st-slider-value">{format ? format(v) : v}</span>
    </span>
  );
}

/** Editable list of strings shown as removable chips (blocked senders etc.) */
export function StringList({ items, onChange, placeholder, validate, empty }: { items: string[]; onChange: (items: string[]) => void; placeholder: string; validate?: (s: string) => string | null; empty: string }): JSX.Element {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = (): void => {
    const v = text.trim().toLowerCase();
    if (!v) return;
    const err = validate?.(v) ?? null;
    if (err) {
      setError(err);
      return;
    }
    if (!items.includes(v)) onChange([...items, v].sort());
    setText('');
    setError(null);
  };
  return (
    <div className="col st-list-editor">
      <div className="row">
        <input
          className={clsx('input grow', error && 'invalid')}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <Button icon={<Plus size={16} />} onClick={add} disabled={!text.trim()}>
          Hinzufügen
        </Button>
      </div>
      {error && <span className="st-error small-text">{error}</span>}
      {items.length === 0 ? (
        <span className="muted small-text">{empty}</span>
      ) : (
        <div className="st-chips">
          {items.map((s) => (
            <span key={s} className="chip st-chip">
              {s}
              <IconButton small label={`${s} entfernen`} onClick={() => onChange(items.filter((x) => x !== s))}>
                <X size={12} />
              </IconButton>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function formatDateTime(ms: number | null): string {
  if (!ms) return '–';
  return new Date(ms).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}

/** Moves item at index i by d positions (returns a new array, unchanged if out of range) */
export function moveItem<T>(list: T[], i: number, d: number): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
