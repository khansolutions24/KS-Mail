// Finds IMAP/SMTP settings for an address: built-in presets → Thunderbird ISPDB → MX records → guess.

import dns from 'node:dns/promises';
import type { AutoConfigResult } from '@shared/api';
import { presetFor } from '@shared/defaults';

type Sec = 'tls' | 'starttls' | 'none';

function socketType(s: string): Sec {
  const v = s.toUpperCase();
  return v === 'SSL' ? 'tls' : v === 'STARTTLS' ? 'starttls' : 'none';
}

function parseIspdb(xml: string, email: string, domain: string): AutoConfigResult | null {
  const block = (tag: string, type: string): { host: string; port: number; security: Sec } | null => {
    const re = new RegExp(`<${tag}[^>]*type="${type}"[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
    const m = re.exec(xml);
    if (!m) return null;
    const get = (n: string): string => new RegExp(`<${n}>([^<]*)</${n}>`, 'i').exec(m[1])?.[1]?.trim() ?? '';
    const host = get('hostname')
      .replace('%EMAILDOMAIN%', domain)
      .replace('%EMAILADDRESS%', email);
    if (!host) return null;
    return { host, port: Number(get('port')) || 0, security: socketType(get('socketType')) };
  };
  const imap = block('incomingServer', 'imap');
  const smtp = block('outgoingServer', 'smtp');
  if (!imap || !smtp) return null;
  return { imap, smtp, source: 'Mozilla ISPDB' };
}

async function fetchText(url: string, ms = 5000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

export async function autoConfig(email: string): Promise<AutoConfigResult | null> {
  const domain = email.split('@')[1]?.toLowerCase().trim();
  if (!domain) return null;
  const preset = presetFor(email);
  if (preset) {
    return {
      imap: { host: preset.imap[0], port: preset.imap[1], security: preset.imap[2] },
      smtp: { host: preset.smtp[0], port: preset.smtp[1], security: preset.smtp[2] },
      oauthProvider: preset.oauth,
      source: preset.name
    };
  }
  const own = await fetchText(`https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(email)}`, 3000);
  const fromOwn = own ? parseIspdb(own, email, domain) : null;
  if (fromOwn) return { ...fromOwn, source: 'Anbieter-Autoconfig' };
  const ispdb = await fetchText(`https://autoconfig.thunderbird.net/v1.1/${domain}`);
  const fromDb = ispdb ? parseIspdb(ispdb, email, domain) : null;
  if (fromDb) return fromDb;
  try {
    const mx = (await dns.resolveMx(domain)).sort((a, b) => a.priority - b.priority)[0]?.exchange.toLowerCase() ?? '';
    if (mx.endsWith('google.com') || mx.endsWith('googlemail.com')) {
      return { imap: { host: 'imap.gmail.com', port: 993, security: 'tls' }, smtp: { host: 'smtp.gmail.com', port: 465, security: 'tls' }, oauthProvider: 'google', source: 'Google Workspace (MX)' };
    }
    if (mx.endsWith('outlook.com')) {
      return { imap: { host: 'outlook.office365.com', port: 993, security: 'tls' }, smtp: { host: 'smtp.office365.com', port: 587, security: 'starttls' }, oauthProvider: 'microsoft', source: 'Microsoft 365 (MX)' };
    }
    const mxDomain = mx.split('.').slice(-2).join('.');
    if (mxDomain && mxDomain !== domain) {
      const viaMx = await fetchText(`https://autoconfig.thunderbird.net/v1.1/${mxDomain}`);
      const r = viaMx ? parseIspdb(viaMx, email, domain) : null;
      if (r) return { ...r, source: `ISPDB (${mxDomain})` };
    }
  } catch {
    // no MX lookup possible
  }
  return { imap: { host: `imap.${domain}`, port: 993, security: 'tls' }, smtp: { host: `smtp.${domain}`, port: 587, security: 'starttls' }, source: 'Vermutung' };
}
