// Small rich-text editor (contentEditable + execCommand) with an HTML source toggle.
// The editor is uncontrolled while typing: content is loaded on mount only (give it a `key` per document),
// and changes are reported debounced, on blur and on unmount.

import clsx from 'clsx';
import { Bold, Code2, Italic, Link, List, ListOrdered, Palette, RemoveFormatting, Underline, Unlink } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { prompt } from '../store/app';
import { IconButton, useOutside } from '../components/ui';

const COLORS = ['#000000', '#424242', '#8a8a8a', '#d13438', '#ca5010', '#c19c00', '#107c10', '#038387', '#0f6cbd', '#004e8c', '#8764b8', '#e3008c'];

export function RichEditor({ value, onChange, minHeight = 180, placeholder }: { value: string; onChange: (html: string) => void; minHeight?: number; placeholder?: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const emitted = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [htmlMode, setHtmlMode] = useState(false);
  const [source, setSource] = useState(value);
  // current source text while in HTML mode (read by flush on unmount)
  const sourceRef = useRef<string | null>(null);
  sourceRef.current = htmlMode ? source : null;
  const [colors, setColors] = useState(false);
  const colorRef = useOutside<HTMLDivElement>(useCallback(() => setColors(false), []));

  const emit = useCallback((html: string) => {
    window.clearTimeout(timer.current);
    if (html === emitted.current) return;
    emitted.current = html;
    onChangeRef.current(html);
  }, []);

  // last known editor HTML; kept in a ref because the DOM node is already detached when unmount cleanups run
  const htmlRef = useRef(value);

  const flush = useCallback(() => {
    if (sourceRef.current !== null) {
      emit(sourceRef.current);
      return;
    }
    if (ref.current) htmlRef.current = ref.current.innerHTML;
    emit(htmlRef.current);
  }, [emit]);

  // load the document once
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = value;
    emitted.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => flush(), [flush]);

  // remember the last selection inside the editor so toolbar actions (and prompts) can restore it
  useEffect(() => {
    const onSel = (): void => {
      const sel = document.getSelection();
      if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  const restore = (): void => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = document.getSelection();
    if (range.current && sel) {
      sel.removeAllRanges();
      sel.addRange(range.current);
    }
  };

  const exec = (cmd: string, arg?: string): void => {
    restore();
    document.execCommand('styleWithCSS', false, cmd === 'foreColor' ? 'true' : 'false');
    document.execCommand(cmd, false, arg);
    flush();
  };

  const addLink = async (): Promise<void> => {
    const saved = range.current;
    const selected = saved?.toString() ?? '';
    const input = await prompt('Link einfügen', /^https?:\/\//.test(selected) ? selected : 'https://', 'Adresse (URL oder E-Mail)', 'Einfügen');
    range.current = saved;
    if (!input?.trim()) return;
    let url = input.trim();
    if (!/^(https?:|mailto:|tel:)/i.test(url)) url = url.includes('@') && !url.includes('/') ? `mailto:${url}` : `https://${url}`;
    if (saved && !saved.collapsed) exec('createLink', url);
    else exec('insertHTML', `<a href="${url.replace(/"/g, '&quot;')}">${url.replace(/^mailto:/, '').replace(/</g, '&lt;')}</a>`);
  };

  const toggleHtml = (): void => {
    if (!htmlMode) {
      setSource(ref.current?.innerHTML ?? '');
      setHtmlMode(true);
    } else {
      if (ref.current) ref.current.innerHTML = source;
      htmlRef.current = source;
      emit(source);
      setHtmlMode(false);
    }
  };

  // keep focus in the editor when clicking toolbar buttons
  const keep = (e: React.MouseEvent): void => e.preventDefault();

  return (
    <div className="st-rich">
      <div className="st-rich-toolbar" onMouseDown={htmlMode ? undefined : keep}>
        <IconButton small label="Fett (Strg+B)" disabled={htmlMode} onClick={() => exec('bold')}>
          <Bold size={15} />
        </IconButton>
        <IconButton small label="Kursiv (Strg+I)" disabled={htmlMode} onClick={() => exec('italic')}>
          <Italic size={15} />
        </IconButton>
        <IconButton small label="Unterstrichen (Strg+U)" disabled={htmlMode} onClick={() => exec('underline')}>
          <Underline size={15} />
        </IconButton>
        <div className="st-rich-popwrap" ref={colorRef}>
          <IconButton small label="Schriftfarbe" disabled={htmlMode} active={colors} onClick={() => setColors(!colors)}>
            <Palette size={15} />
          </IconButton>
          {colors && (
            <div className="st-rich-pop">
              {COLORS.map((c) => (
                <span
                  key={c}
                  className="color-swatch"
                  style={{ background: c }}
                  title={c}
                  onClick={() => {
                    exec('foreColor', c);
                    setColors(false);
                  }}
                />
              ))}
            </div>
          )}
        </div>
        <span className="st-rich-sep" />
        <IconButton small label="Aufzählung" disabled={htmlMode} onClick={() => exec('insertUnorderedList')}>
          <List size={15} />
        </IconButton>
        <IconButton small label="Nummerierung" disabled={htmlMode} onClick={() => exec('insertOrderedList')}>
          <ListOrdered size={15} />
        </IconButton>
        <span className="st-rich-sep" />
        <IconButton small label="Link einfügen" disabled={htmlMode} onClick={() => void addLink()}>
          <Link size={15} />
        </IconButton>
        <IconButton small label="Link entfernen" disabled={htmlMode} onClick={() => exec('unlink')}>
          <Unlink size={15} />
        </IconButton>
        <IconButton small label="Formatierung entfernen" disabled={htmlMode} onClick={() => exec('removeFormat')}>
          <RemoveFormatting size={15} />
        </IconButton>
        <span className="grow" />
        <button type="button" className={clsx('btn subtle small', htmlMode && 'st-active')} onMouseDown={(e) => e.preventDefault()} onClick={toggleHtml}>
          <Code2 size={14} /> {htmlMode ? 'Visuell bearbeiten' : 'HTML bearbeiten'}
        </button>
      </div>
      <div
        ref={ref}
        className="st-rich-area selectable"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        style={{ minHeight, display: htmlMode ? 'none' : undefined }}
        onInput={() => {
          if (ref.current) htmlRef.current = ref.current.innerHTML;
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(flush, 500);
        }}
        onBlur={flush}
      />
      {htmlMode && (
        <textarea
          className="textarea st-rich-source"
          style={{ minHeight }}
          value={source}
          spellCheck={false}
          onChange={(e) => {
            setSource(e.target.value);
            window.clearTimeout(timer.current);
            const v = e.target.value;
            timer.current = window.setTimeout(() => emit(v), 600);
          }}
          onBlur={() => emit(source)}
        />
      )}
    </div>
  );
}
