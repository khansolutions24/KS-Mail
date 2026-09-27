// Pieces shared by the add-account wizard and the account editor: server fields, test result, helpers.

import { CheckCircle2, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Account, Security, ServerConfig } from '@shared/types';
import type { AccountTestResult } from '@shared/api';
import { Checkbox, Field } from '../components/ui';
import { Select, type Opt } from './common';

const SECURITY: Opt<Security>[] = [
  { value: 'tls', label: 'SSL/TLS' },
  { value: 'starttls', label: 'STARTTLS' },
  { value: 'none', label: 'Keine (unverschlüsselt)' }
];

/** Standard ports per protocol and security mode */
const PORTS: Record<'imap' | 'smtp', Record<Security, number>> = {
  imap: { tls: 993, starttls: 143, none: 143 },
  smtp: { tls: 465, starttls: 587, none: 25 }
};

export function ServerFields({ kind, value, onChange, passwordSlot }: { kind: 'imap' | 'smtp'; value: ServerConfig; onChange: (v: ServerConfig) => void; passwordSlot?: ReactNode }): JSX.Element {
  const set = (patch: Partial<ServerConfig>): void => onChange({ ...value, ...patch });
  const changeSecurity = (security: Security): void => {
    // only adjust the port when it still is one of the standard ports (keeps custom ports)
    const std = Object.values(PORTS[kind]);
    set({ security, port: std.includes(value.port) ? PORTS[kind][security] : value.port });
  };
  return (
    <fieldset className="st-server">
      <legend>{kind === 'imap' ? 'Posteingangsserver (IMAP)' : 'Postausgangsserver (SMTP)'}</legend>
      <div className="st-grid-server">
        <Field label="Server">
          <input className="input" value={value.host} placeholder={kind === 'imap' ? 'imap.example.com' : 'smtp.example.com'} onChange={(e) => set({ host: e.target.value.trim() })} spellCheck={false} />
        </Field>
        <Field label="Port">
          <input className="input" type="number" min={1} max={65535} value={value.port} onChange={(e) => set({ port: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="Verschlüsselung">
          <Select value={value.security} options={SECURITY} onChange={changeSecurity} />
        </Field>
        <Field label="Benutzername">
          <input className="input" value={value.user} onChange={(e) => set({ user: e.target.value.trim() })} spellCheck={false} autoComplete="off" />
        </Field>
      </div>
      {passwordSlot}
      {value.security === 'none' && <div className="st-warning small-text">Ohne Verschlüsselung werden Passwort und Nachrichten im Klartext übertragen.</div>}
    </fieldset>
  );
}

export function InvalidCertCheckbox({ account, onChange }: { account: Account; onChange: (a: Account) => void }): JSX.Element {
  const checked = !!account.imap.allowInvalidCert || !!account.smtp.allowInvalidCert;
  return (
    <Checkbox
      checked={checked}
      onChange={(v) => onChange({ ...account, imap: { ...account.imap, allowInvalidCert: v }, smtp: { ...account.smtp, allowInvalidCert: v } })}
      label="Zertifikat nicht prüfen (nur für Server mit selbstsigniertem Zertifikat)"
    />
  );
}

export function TestResultView({ result }: { result: AccountTestResult }): JSX.Element {
  const line = (label: string, r: { ok: boolean; message: string }): JSX.Element => (
    <div className={r.ok ? 'st-test ok' : 'st-test fail'}>
      {r.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
      <strong>{label}:</strong>
      <span className="grow selectable">{r.message || (r.ok ? 'Verbindung erfolgreich' : 'Fehlgeschlagen')}</span>
    </div>
  );
  return (
    <div className="col st-test-result">
      {line('IMAP', result.imap)}
      {line('SMTP', result.smtp)}
    </div>
  );
}

/** Returns a copy of the account carrying the given passwords (empty = not sent = unchanged) */
export function withPasswords(a: Account, imapPassword: string, smtpPassword: string): Account {
  return {
    ...a,
    imap: { ...a.imap, password: imapPassword || undefined },
    smtp: { ...a.smtp, password: smtpPassword || undefined }
  };
}

export function providerLabel(p: 'microsoft' | 'google'): string {
  return p === 'microsoft' ? 'Microsoft' : 'Google';
}

export function validateServers(a: Account): string | null {
  if (!a.imap.host) return 'Bitte den IMAP-Server angeben.';
  if (!a.smtp.host) return 'Bitte den SMTP-Server angeben.';
  if (!(a.imap.port > 0 && a.imap.port < 65536) || !(a.smtp.port > 0 && a.smtp.port < 65536)) return 'Bitte gültige Ports angeben (1–65535).';
  if (!a.imap.user) return 'Bitte den Benutzernamen angeben.';
  return null;
}
