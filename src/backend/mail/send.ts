// Building MIME messages and sending them over SMTP.

import fs from 'node:fs';
import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type Mail from 'nodemailer/lib/mailer';
import type { Account, Draft } from '@shared/types';
import { formatAddress, htmlToText } from '@shared/util';
import type { AuthProvider } from './imap';

export interface BuiltMessage {
  raw: Buffer;
  messageId: string;
  envelope: { from: string; to: string[] };
}

export type AttachmentResolver = (ref: { messageId: number; index: number }) => Promise<{ filename: string; contentType: string; content: Buffer }>;

export interface ExtraParts {
  icalEvent?: { method: string; content: string };
  headers?: Record<string, string>;
}

export async function buildMessage(account: Account, draft: Draft, resolve: AttachmentResolver, extra: ExtraParts = {}): Promise<BuiltMessage> {
  const attachments: Mail.Attachment[] = [];
  for (const a of draft.attachments) {
    if (a.fromMessage) {
      const r = await resolve(a.fromMessage);
      attachments.push({ filename: a.filename || r.filename, contentType: r.contentType, content: r.content });
    } else if (a.path) {
      attachments.push({ filename: a.filename, contentType: a.contentType, content: await fs.promises.readFile(a.path) });
    } else if (a.dataBase64 !== undefined) {
      attachments.push({ filename: a.filename, contentType: a.contentType, content: Buffer.from(a.dataBase64, 'base64') });
    }
  }
  // inline images pasted into the editor as data: URLs become cid attachments
  let html = draft.html;
  let n = 0;
  html = html.replace(/src="data:(image\/[a-z+.-]+);base64,([^"]+)"/gi, (_m, type: string, data: string) => {
    const cid = `img${++n}.${Date.now()}@ksmail`;
    attachments.push({ filename: `bild${n}.${type.split('/')[1]?.replace('+xml', '') ?? 'png'}`, contentType: type, content: Buffer.from(data, 'base64'), cid });
    return `src="cid:${cid}"`;
  });
  const headers: Record<string, string> = { 'X-Mailer': 'KS Mail', ...extra.headers };
  if (draft.importance === 'high') Object.assign(headers, { Importance: 'high', 'X-Priority': '1 (Highest)' });
  if (draft.importance === 'low') Object.assign(headers, { Importance: 'low', 'X-Priority': '5 (Lowest)' });
  if (draft.requestReadReceipt) headers['Disposition-Notification-To'] = account.email;
  const from = { name: account.displayName || account.name, address: account.email };
  const opts: Mail.Options = {
    from: formatAddress(from),
    to: draft.to.map(formatAddress),
    cc: draft.cc.map(formatAddress),
    bcc: draft.bcc.map(formatAddress),
    subject: draft.subject,
    html: `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`,
    text: htmlToText(html),
    attachments,
    headers,
    inReplyTo: draft.inReplyTo || undefined,
    references: draft.references?.length ? draft.references.join(' ') : undefined,
    icalEvent: extra.icalEvent ? { method: extra.icalEvent.method, content: extra.icalEvent.content } : undefined,
    date: new Date()
  };
  const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  const info = (await composer.sendMail(opts)) as unknown as { message: Buffer; messageId: string; envelope: { from: string; to: string[] } };
  return { raw: info.message, messageId: info.messageId, envelope: info.envelope };
}

export async function smtpTransport(account: Account, auth: AuthProvider): Promise<Transporter<SMTPTransport.SentMessageInfo>> {
  const a = await auth();
  const s = account.smtp;
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.security === 'tls',
    requireTLS: s.security === 'starttls',
    ignoreTLS: s.security === 'none',
    auth: a.accessToken ? { type: 'OAuth2', user: a.user, accessToken: a.accessToken } : { user: a.user, pass: a.pass ?? '' },
    tls: { rejectUnauthorized: !s.allowInvalidCert, servername: s.host },
    connectionTimeout: 30_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000
  } as SMTPTransport.Options);
}

export async function sendRaw(account: Account, auth: AuthProvider, msg: BuiltMessage): Promise<void> {
  const t = await smtpTransport(account, auth);
  try {
    await t.sendMail({ envelope: msg.envelope, raw: msg.raw });
  } finally {
    t.close();
  }
}

export async function testSmtp(account: Account, auth: AuthProvider): Promise<void> {
  const t = await smtpTransport(account, auth);
  try {
    await t.verify();
  } finally {
    t.close();
  }
}
