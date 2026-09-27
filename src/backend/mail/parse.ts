// Parsing raw RFC 822 messages into what the reading pane shows.

import { simpleParser, type AddressObject, type Attachment, type ParsedMail } from 'mailparser';
import type { Address, AttachmentInfo, MessageBody } from '@shared/types';
import { parseIcs } from '@shared/ics';
import { htmlToText, textToHtml } from '@shared/util';

export function addrList(a: AddressObject | AddressObject[] | undefined): Address[] {
  if (!a) return [];
  const list = Array.isArray(a) ? a : [a];
  return list.flatMap((o) => o.value).flatMap((v) => (v.group ? v.group : [v])).map((v) => ({ name: v.name ?? '', address: v.address ?? '' })).filter((v) => v.address);
}

export async function parseRaw(raw: Buffer): Promise<ParsedMail> {
  return simpleParser(raw, { skipTextToHtml: true, skipImageLinks: true, keepCidLinks: true });
}

function isInline(a: Attachment): boolean {
  return a.contentDisposition === 'inline' && !!a.contentId && a.contentType.startsWith('image/');
}

export function attachmentInfos(p: ParsedMail): AttachmentInfo[] {
  return p.attachments.map((a, index) => ({
    index,
    filename: a.filename || (a.contentType === 'message/rfc822' ? 'Nachricht.eml' : a.contentType === 'text/calendar' ? 'einladung.ics' : `Anhang-${index + 1}`),
    contentType: a.contentType,
    size: a.size,
    contentId: a.contentId ? a.contentId.replace(/^<|>$/g, '') : null,
    inline: isInline(a)
  }));
}

const REMOTE_RE = /(<img[^>]+src\s*=\s*["']?\s*https?:|url\(\s*["']?\s*https?:|<link[^>]+href\s*=\s*["']?https?:|background\s*=\s*["']?https?:)/i;

/** Removes active content. The HTML is additionally rendered in a sandboxed iframe without scripts and with a strict CSP. */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<(script|iframe|object|embed|applet|frame|frameset|form|noscript)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|iframe|object|embed|applet|frame|frameset|meta|base|link(?![^>]*stylesheet))\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|action)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

export function buildBody(id: number, p: ParsedMail): MessageBody {
  const attachments = attachmentInfos(p);
  let html = typeof p.html === 'string' && p.html ? p.html : null;
  const text = p.text ?? (html ? htmlToText(html) : '');
  if (html) {
    html = sanitizeHtml(html);
    // inline images referenced by cid:
    for (const a of p.attachments) {
      if (!a.contentId) continue;
      const cid = a.contentId.replace(/^<|>$/g, '');
      const data = `data:${a.contentType};base64,${a.content.toString('base64')}`;
      html = html.split(`cid:${cid}`).join(data);
    }
  }
  let invite = null;
  const cal = p.attachments.find((a) => a.contentType === 'text/calendar' || /\.ics$/i.test(a.filename ?? ''));
  if (cal) {
    try {
      const parsed = parseIcs(cal.content.toString('utf8'));
      if (parsed.events.length) invite = parsed.events;
    } catch {
      invite = null;
    }
  }
  const headers: { key: string; value: string }[] = [];
  for (const line of p.headerLines) {
    const idx = line.line.indexOf(':');
    headers.push({ key: line.line.slice(0, idx), value: line.line.slice(idx + 1).trim() });
  }
  const refs = p.references ? (Array.isArray(p.references) ? p.references : [p.references]) : [];
  const lu = p.headers.get('list-unsubscribe');
  let listUnsubscribe: string | null = null;
  if (lu) {
    const v = typeof lu === 'string' ? lu : ((lu as { url?: string; mail?: string }).url ?? (lu as { mail?: string }).mail ?? '');
    listUnsubscribe = typeof v === 'string' ? v : null;
    if (listUnsubscribe && !/^(https?:|mailto:)/i.test(listUnsubscribe)) listUnsubscribe = listUnsubscribe.includes('@') ? `mailto:${listUnsubscribe}` : null;
  }
  return {
    id,
    html: html ?? (text ? `<div style="white-space:normal">${textToHtml(text)}</div>` : ''),
    text,
    attachments,
    hasRemoteContent: html ? REMOTE_RE.test(html) : false,
    headers,
    replyTo: addrList(p.replyTo),
    bcc: addrList(p.bcc),
    references: refs,
    invite,
    listUnsubscribe
  };
}
