// Renders message HTML in a sandboxed iframe (no scripts, strict CSP, remote content blocked unless allowed).

import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useApp } from '../store/app';
import { draftFromMailto } from './compose';

function documentFor(html: string, allowRemote: boolean, plain: boolean): string {
  const remote = allowRemote ? ' https: http:' : '';
  const csp = `default-src 'none'; img-src data: cid:${remote}; style-src 'unsafe-inline'${remote}; font-src data:${remote}; media-src data:${remote}`;
  const style = `
    html,body{margin:0;padding:0;background:transparent}
    body{padding:4px 2px 12px;font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.45;color:#242424;word-wrap:break-word;overflow-wrap:anywhere;overflow:hidden}
    img{max-width:100%;height:auto}
    table{max-width:100%}
    pre{white-space:pre-wrap}
    blockquote{margin:0 0 0 8px;padding-left:12px;border-left:3px solid #d1d1d1;color:#424242}
    a{color:#0f6cbd}
    ${plain ? 'body{white-space:normal;font-family:inherit}' : ''}
  `;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>${style}</style></head><body>${html}</body></html>`;
}

export function BodyFrame({ html, allowRemote, plain }: { html: string; allowRemote: boolean; plain?: boolean }): JSX.Element {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let ro: ResizeObserver | null = null;
    const onLoad = (): void => {
      const doc = frame.contentDocument;
      if (!doc) return;
      const measure = (): void => setHeight(Math.max(60, doc.documentElement.scrollHeight));
      measure();
      ro = new ResizeObserver(measure);
      ro.observe(doc.body);
      // images may load later
      for (const img of Array.from(doc.images)) img.addEventListener('load', measure);
      doc.addEventListener('click', (e) => {
        const a = (e.target as HTMLElement).closest('a');
        if (!a) return;
        e.preventDefault();
        const href = a.getAttribute('href') ?? '';
        if (href.startsWith('#')) return;
        if (/^mailto:/i.test(href)) useApp.getState().openComposer(draftFromMailto(href));
        else if (/^https?:/i.test(href)) void api.app.openExternal(href);
      });
    };
    frame.addEventListener('load', onLoad);
    return () => {
      frame.removeEventListener('load', onLoad);
      ro?.disconnect();
    };
  }, [html, allowRemote]);

  return (
    <iframe
      ref={ref}
      className="body-frame"
      title="Nachricht"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={documentFor(html, allowRemote, !!plain)}
      style={{ height }}
    />
  );
}
