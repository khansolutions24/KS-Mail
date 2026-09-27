// Dialog for editing an existing account (all fields, password change, OAuth re-login, connection test).

import { LogIn, Plug } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Account, OAuthProvider } from '@shared/types';
import type { AccountTestResult } from '@shared/api';
import { isValidEmail } from '@shared/util';
import { api, errorMessage } from '../api/client';
import { toast, useApp } from '../store/app';
import { Button, ColorPicker, Dialog, Field, Spinner, Switch } from '../components/ui';
import { Select, type Opt } from './common';
import { InvalidCertCheckbox, ServerFields, TestResultView, providerLabel, validateServers, withPasswords } from './accountForm';

type AuthChoice = 'password' | 'microsoft' | 'google';

export function AccountEditor({ account, onClose }: { account: Account | null; onClose: () => void }): JSX.Element {
  const signatures = useApp((s) => s.settings?.signatures ?? []);
  const [draft, setDraft] = useState<Account | null>(account);
  const [imapPw, setImapPw] = useState('');
  const [smtpPw, setSmtpPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<AccountTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(account);
    setImapPw('');
    setSmtpPw('');
    setTest(null);
    setError(null);
  }, [account]);

  if (!draft) return <></>;

  const set = (patch: Partial<Account>): void => setDraft({ ...draft, ...patch });
  const isDemo = draft.kind === 'demo';
  const authChoice: AuthChoice = draft.auth === 'oauth2' ? (draft.oauthProvider ?? 'microsoft') : 'password';
  const sigOptions: Opt<string>[] = [{ value: '', label: '(Standard)' }, ...signatures.map((s) => ({ value: s.id, label: s.name }))];

  const validate = (): string | null => {
    if (!draft.email || !isValidEmail(draft.email)) return 'Bitte eine gültige E-Mail-Adresse angeben.';
    return isDemo ? null : validateServers(draft);
  };

  const payload = (): Account => withPasswords(draft, draft.auth === 'password' ? imapPw : '', draft.auth === 'password' ? smtpPw : '');

  const save = async (): Promise<void> => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    try {
      await api.accounts.save({ ...payload(), name: draft.name.trim() || draft.email });
      await useApp.getState().loadAccounts();
      toast('success', 'Konto gespeichert');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const runTest = async (): Promise<void> => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setTesting(true);
    setTest(null);
    try {
      setTest(await api.accounts.test(payload()));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTesting(false);
    }
  };

  const oauthLogin = async (p: OAuthProvider): Promise<void> => {
    setBusy(true);
    try {
      // persist the current auth choice first so the backend stores the token for this account
      await api.accounts.save({ ...withPasswords(draft, '', ''), auth: 'oauth2', oauthProvider: p });
      toast('info', `Der Browser öffnet sich für die Anmeldung bei ${providerLabel(p)} …`);
      await api.accounts.oauthLogin(draft.id, p, draft.email);
      await useApp.getState().loadAccounts();
      toast('success', 'Anmeldung erfolgreich');
      set({ auth: 'oauth2', oauthProvider: p, hasSecret: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const changeAuth = (c: AuthChoice): void => (c === 'password' ? set({ auth: 'password', oauthProvider: undefined }) : set({ auth: 'oauth2', oauthProvider: c }));

  return (
    <Dialog
      open={!!account}
      onClose={onClose}
      title={`Konto bearbeiten – ${account?.name ?? ''}`}
      width={700}
      footer={
        <>
          {!isDemo && (
            <Button icon={testing ? <Spinner /> : <Plug size={16} />} onClick={() => void runTest()} disabled={testing || busy}>
              Verbindung testen
            </Button>
          )}
          <span className="grow" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy} icon={busy ? <Spinner /> : undefined}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="col st-wizard-form">
        <div className="st-grid-2">
          <Field label="Kontobezeichnung">
            <input className="input" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Anzeigename (Absender)">
            <input className="input" value={draft.displayName} onChange={(e) => set({ displayName: e.target.value })} />
          </Field>
          <Field label="E-Mail-Adresse">
            <input className="input" type="email" value={draft.email} onChange={(e) => set({ email: e.target.value.trim() })} disabled={isDemo} />
          </Field>
          <Field label="Signatur">
            <Select value={draft.signatureId ?? ''} options={sigOptions} onChange={(v) => set({ signatureId: v || undefined })} />
          </Field>
          <Field label="Synchronisierungsintervall (Minuten)" hint="Der Posteingang wird zusätzlich per Push (IDLE) aktualisiert.">
            <input className="input" type="number" min={1} max={1440} value={draft.syncInterval} onChange={(e) => set({ syncInterval: Math.max(1, Number(e.target.value) || 1) })} />
          </Field>
          <Field label="Nachrichten pro Ordner beim ersten Abruf">
            <input className="input" type="number" min={50} max={100000} step={50} value={draft.initialLimit} onChange={(e) => set({ initialLimit: Math.max(1, Number(e.target.value) || 1) })} />
          </Field>
        </div>
        <Field label="Farbe">
          <ColorPicker value={draft.color} onChange={(color) => set({ color })} />
        </Field>
        <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>
          <Switch checked={draft.enabled} onChange={(enabled) => set({ enabled })} label="Konto aktiviert" />
          <Switch checked={draft.saveSent} onChange={(saveSent) => set({ saveSent })} label="Gesendete Elemente speichern" />
        </div>

        {!isDemo && (
          <>
            <div className="st-divider" />
            <Field label="Anmeldung">
              <Select<AuthChoice>
                value={authChoice}
                style={{ maxWidth: 320 }}
                options={[
                  { value: 'password', label: 'Passwort / App-Passwort' },
                  { value: 'microsoft', label: 'OAuth – Microsoft' },
                  { value: 'google', label: 'OAuth – Google' }
                ]}
                onChange={changeAuth}
              />
            </Field>
            {draft.auth === 'oauth2' && draft.oauthProvider && (
              <div className="row st-hint">
                <span className="grow small-text">{draft.hasSecret ? 'Ein Anmeldetoken ist gespeichert.' : 'Noch nicht angemeldet – bitte anmelden.'}</span>
                <Button small icon={<LogIn size={14} />} onClick={() => void oauthLogin(draft.oauthProvider!)} disabled={busy}>
                  {draft.hasSecret ? 'Erneut anmelden' : 'Anmelden'}
                </Button>
              </div>
            )}
            <ServerFields
              kind="imap"
              value={draft.imap}
              onChange={(imap) => set({ imap })}
              passwordSlot={
                draft.auth === 'password' && (
                  <Field label="Passwort ändern" hint={draft.hasSecret ? 'Leer lassen, um das gespeicherte Passwort zu behalten.' : 'Es ist noch kein Passwort gespeichert.'} style={{ marginTop: 8 }}>
                    <input className="input" type="password" value={imapPw} placeholder={draft.hasSecret ? '••••••••' : ''} onChange={(e) => setImapPw(e.target.value)} autoComplete="new-password" />
                  </Field>
                )
              }
            />
            <ServerFields
              kind="smtp"
              value={draft.smtp}
              onChange={(smtp) => set({ smtp })}
              passwordSlot={
                draft.auth === 'password' && (
                  <Field label="Separates SMTP-Passwort (optional)" hint="Nur nötig, wenn sich das SMTP-Passwort vom IMAP-Passwort unterscheidet. Leer = unverändert." style={{ marginTop: 8 }}>
                    <input className="input" type="password" value={smtpPw} onChange={(e) => setSmtpPw(e.target.value)} autoComplete="new-password" />
                  </Field>
                )
              }
            />
            <InvalidCertCheckbox account={draft} onChange={setDraft} />
          </>
        )}
        {isDemo && <div className="st-hint small-text">Demo-Konto – keine Serververbindung, die Nachrichten werden lokal erzeugt.</div>}
        {test && <TestResultView result={test} />}
        {error && <div className="st-error-box">{error}</div>}
      </div>
    </Dialog>
  );
}
