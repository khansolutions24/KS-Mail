// Creating drafts: new mail, mailto: links, replies with signature, templates.

import type { Address, Draft } from '@shared/types';
import { escapeHtml, newId, parseAddressList } from '@shared/util';
import { api } from '../api/client';
import { useApp } from '../store/app';

export function defaultAccountId(): string {
  const { settings, accounts } = useApp.getState();
  const enabled = accounts.filter((a) => a.enabled);
  return enabled.find((a) => a.id === settings?.defaultAccountId)?.id ?? enabled[0]?.id ?? accounts[0]?.id ?? '';
}

export function signatureHtml(accountId: string, isReply: boolean): string {
  const { settings, accounts } = useApp.getState();
  if (!settings) return '';
  if (isReply && !settings.mail.signatureOnReply) return '';
  const acc = accounts.find((a) => a.id === accountId);
  const id = acc?.signatureId || settings.mail.defaultSignatureId;
  const sig = settings.signatures.find((s) => s.id === id);
  return sig ? `<div id="ks-signature"><br>${sig.html}</div>` : '';
}

function bodyStyle(): string {
  const s = useApp.getState().settings;
  return `font-family:${s?.mail.composeFont ?? 'Segoe UI, sans-serif'};font-size:${s?.mail.composeFontSize ?? 11}pt`;
}

export function wrapBody(inner: string): string {
  return `<div style="${bodyStyle()}">${inner}</div>`;
}

export function newDraft(opts: { to?: Address[]; cc?: Address[]; bcc?: Address[]; subject?: string; html?: string; accountId?: string } = {}): Draft {
  const accountId = opts.accountId ?? defaultAccountId();
  return {
    id: newId(),
    accountId,
    to: opts.to ?? [],
    cc: opts.cc ?? [],
    bcc: opts.bcc ?? [],
    subject: opts.subject ?? '',
    html: wrapBody(`<p>${opts.html ?? '<br>'}</p>${signatureHtml(accountId, false)}`),
    attachments: [],
    mode: 'new',
    importance: 'normal',
    plainText: useApp.getState().settings?.mail.composeFormat === 'text'
  };
}

export function draftFromMailto(url: string): Draft {
  const u = new URL(url.replace(/^mailto:/i, 'mailto:'));
  const to = parseAddressList(decodeURIComponent(u.pathname));
  const p = u.searchParams;
  const body = p.get('body') ?? '';
  return newDraft({
    to: [...to, ...parseAddressList(p.get('to') ?? '')],
    cc: parseAddressList(p.get('cc') ?? ''),
    bcc: parseAddressList(p.get('bcc') ?? ''),
    subject: p.get('subject') ?? '',
    html: escapeHtml(body).replace(/\r?\n/g, '<br>')
  });
}

export async function replyDraft(mode: 'reply' | 'replyAll' | 'forward', messageId: number): Promise<Draft> {
  const d = await api.compose.prepare(mode, messageId);
  const top = useApp.getState().settings?.mail.replyQuotePosition !== 'bottom';
  const sig = signatureHtml(d.accountId, true);
  d.html = top ? wrapBody(`<p><br></p>${sig}${d.html}`) : wrapBody(`${d.html}<p><br></p>${sig}`);
  d.plainText = useApp.getState().settings?.mail.composeFormat === 'text';
  return d;
}

export async function editDraft(messageId: number): Promise<Draft> {
  return api.compose.prepare('edit', messageId);
}

export function fromTemplate(templateId: string): Draft | null {
  const t = useApp.getState().settings?.templates.find((x) => x.id === templateId);
  if (!t) return null;
  const d = newDraft({ subject: t.subject });
  d.html = wrapBody(t.html + signatureHtml(d.accountId, false));
  return d;
}
