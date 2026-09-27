// Small reusable UI components.

import * as RDialog from '@radix-ui/react-dialog';
import * as RMenu from '@radix-ui/react-dropdown-menu';
import * as RContext from '@radix-ui/react-context-menu';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { colorFor, initials } from '@shared/util';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'subtle' | 'danger'; small?: boolean; icon?: ReactNode };

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant, small, icon, className, children, type, ...rest }, ref) {
  return (
    <button ref={ref} type={type ?? 'button'} className={clsx('btn', variant, small && 'small', className)} {...rest}>
      {icon}
      {children}
    </button>
  );
});

type IconBtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; small?: boolean; label: string };

export const IconButton = forwardRef<HTMLButtonElement, IconBtnProps>(function IconButton({ active, small, label, className, children, type, ...rest }, ref) {
  return (
    <button ref={ref} type={type ?? 'button'} title={label} aria-label={label} className={clsx('icon-btn', active && 'active', small && 'small', className)} {...rest}>
      {children}
    </button>
  );
});

export function Avatar({ name, email, size = 32, color }: { name: string; email?: string; size?: number; color?: string }): JSX.Element {
  const label = name || email || '?';
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: color ?? colorFor(email || name) }} title={email ? `${name} <${email}>` : name}>
      {initials(label)}
    </span>
  );
}

export function Spinner(): JSX.Element {
  return <span className="spinner" />;
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }): JSX.Element {
  return (
    <label className="switch" style={disabled ? { opacity: 0.5 } : undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }): JSX.Element {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Field({ label, hint, children, style }: { label: ReactNode; hint?: ReactNode; children: ReactNode; style?: React.CSSProperties }): JSX.Element {
  return (
    <div className="field" style={style}>
      <label>{label}</label>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }): JSX.Element {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = 480,
  height
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number | string;
  height?: number | string;
}): JSX.Element {
  return (
    <RDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RDialog.Portal>
        <RDialog.Overlay className="dialog-overlay" />
        <RDialog.Content className="dialog" style={{ width, height }} aria-describedby={undefined} onKeyDown={(e) => e.stopPropagation()}>
          <div className="dialog-header">
            <RDialog.Title className="dialog-title">{title}</RDialog.Title>
            <RDialog.Close asChild>
              <IconButton label="Schließen">
                <X size={18} />
              </IconButton>
            </RDialog.Close>
          </div>
          <div className="dialog-body" style={height ? { flex: 1 } : undefined}>
            {children}
          </div>
          {footer && <div className="dialog-footer">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

// ─── menus ───

export interface MenuEntry {
  label?: string;
  icon?: ReactNode;
  shortcut?: string;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  header?: string;
  swatch?: string;
  checked?: boolean;
  children?: MenuEntry[];
}

function renderEntries(entries: MenuEntry[], M: typeof RMenu | typeof RContext): ReactNode {
  return entries.map((e, i) => {
    if (e.separator) return <M.Separator key={i} className="menu-sep" />;
    if (e.header) return <M.Label key={i} className="menu-label">{e.header}</M.Label>;
    if (e.children) {
      return (
        <M.Sub key={i}>
          <M.SubTrigger className={clsx('menu-item', e.danger && 'danger')} disabled={e.disabled}>
            {e.icon}
            {e.swatch && <span className="menu-swatch" style={{ background: e.swatch }} />}
            <span className="grow">{e.label}</span>
            <span className="shortcut">›</span>
          </M.SubTrigger>
          <M.Portal>
            <M.SubContent className="menu" sideOffset={2} collisionPadding={8}>
              {renderEntries(e.children, M)}
            </M.SubContent>
          </M.Portal>
        </M.Sub>
      );
    }
    return (
      <M.Item key={i} className={clsx('menu-item', e.danger && 'danger')} disabled={e.disabled} onSelect={() => e.onSelect?.()}>
        {e.icon ?? (e.checked !== undefined ? <span style={{ width: 16, textAlign: 'center' }}>{e.checked ? '✓' : ''}</span> : null)}
        {e.swatch && <span className="menu-swatch" style={{ background: e.swatch }} />}
        <span className="grow">{e.label}</span>
        {e.shortcut && <span className="shortcut">{e.shortcut}</span>}
      </M.Item>
    );
  });
}

export function Menu({ trigger, items, align = 'start' }: { trigger: ReactNode; items: MenuEntry[]; align?: 'start' | 'end' | 'center' }): JSX.Element {
  return (
    <RMenu.Root modal={false}>
      <RMenu.Trigger asChild>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content className="menu" align={align} sideOffset={4} collisionPadding={8} onCloseAutoFocus={(e) => e.preventDefault()}>
          {renderEntries(items, RMenu)}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}

export function ContextMenu({ children, items, onOpen }: { children: ReactNode; items: MenuEntry[] | (() => MenuEntry[]); onOpen?: () => void }): JSX.Element {
  const [entries, setEntries] = useState<MenuEntry[]>([]);
  return (
    <RContext.Root
      modal={false}
      onOpenChange={(o) => {
        if (o) {
          onOpen?.();
          setEntries(typeof items === 'function' ? items() : items);
        }
      }}
    >
      <RContext.Trigger asChild>{children}</RContext.Trigger>
      <RContext.Portal>
        <RContext.Content className="menu" collisionPadding={8}>
          {renderEntries(entries, RContext)}
        </RContext.Content>
      </RContext.Portal>
    </RContext.Root>
  );
}

// ─── splitter ───

function readSize(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem('split:' + key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

/** Persistent pane size controlled by a draggable splitter */
export function useSplit(key: string, initial: number, min: number, max: number): [number, (e: React.PointerEvent, invert?: boolean, vertical?: boolean) => void, boolean] {
  const [size, setSize] = useState(() => Math.min(max, Math.max(min, readSize(key, initial))));
  const [dragging, setDragging] = useState(false);
  const start = useCallback(
    (e: React.PointerEvent, invert = false, vertical = false) => {
      e.preventDefault();
      const origin = vertical ? e.clientY : e.clientX;
      const base = size;
      setDragging(true);
      let last = base;
      const move = (ev: PointerEvent): void => {
        const d = (vertical ? ev.clientY : ev.clientX) - origin;
        last = Math.min(max, Math.max(min, base + (invert ? -d : d)));
        setSize(last);
      };
      const up = (): void => {
        setDragging(false);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        try {
          localStorage.setItem('split:' + key, String(last));
        } catch {
          // ignore
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [size, min, max, key]
  );
  return [size, start, dragging];
}

export function Splitter({ onPointerDown, dragging, horizontal }: { onPointerDown: (e: React.PointerEvent) => void; dragging: boolean; horizontal?: boolean }): JSX.Element {
  return <div className={clsx('splitter', horizontal && 'horizontal', dragging && 'dragging')} onPointerDown={onPointerDown} />;
}

export function ColorPicker({ value, onChange, colors }: { value: string; onChange: (c: string) => void; colors?: string[] }): JSX.Element {
  const list = colors ?? ['#0f6cbd', '#8764b8', '#c239b3', '#e3008c', '#d13438', '#ca5010', '#c19c00', '#498205', '#107c10', '#038387', '#00666d', '#5c2e91', '#69797e', '#393939'];
  return (
    <div className="color-swatches">
      {list.map((c) => (
        <span key={c} className={clsx('color-swatch', c.toLowerCase() === value.toLowerCase() && 'active')} style={{ background: c }} onClick={() => onChange(c)} title={c} />
      ))}
    </div>
  );
}

/** Calls fn when clicking outside of the returned ref */
export function useOutside<T extends HTMLElement>(fn: () => void): React.RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const h = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) fn();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [fn]);
  return ref;
}
