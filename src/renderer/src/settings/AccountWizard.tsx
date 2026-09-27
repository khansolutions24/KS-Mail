// "Konto hinzufügen" wizard: identity → (OAuth or app password) → server settings + test → done.

import clsx from 'clsx';
import { ExternalLink, KeyRound, LogIn, MailCheck, Plug, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Account, OAuthProvider } from '@shared/types';
import type { AccountTestResult, AutoConfigResult } from '@shared/api';
import { defaultAccount, presetFor } from '@shared/defaults';
import { colorFor, isValidEmail } from '@shared/util';
import { api, errorMessage } from '../api/client';
import { toast, useApp } from '../store/app';
import { Button, Checkbox, ColorPicker, Dialog, Field, Spinner } from '../components/ui';
import { InvalidCertCheckbox, ServerFields, TestResultView, providerLabel, validateServers, withPasswords } from './accountForm';

type Step = 'identity' | 'method' | 'server' | 'done';

const STEPS: { id: Step; label: string }[] = [
  { id: 'identity', label: 'Konto' },
  { id: 'method', label: 'Anmeldung' },
  { id: 'server', label: 'Server' },
  { id: 'done', label: 'Fertig' }
];

async function refreshAccounts(): Promise<void> {
  const s = useApp.getState();
  await Promise.all([s.loadAccounts(), s.loadFolders()]).catch(() => undefined);
}

export function AccountWizard({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const oauthSettings = useApp((s) => s.settings?.oauth);
  const accountCount = useApp((s) => s.accounts.length);

  const [step, setStep] = useState<Step>('identity');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [smtpOwn, setSmtpOwn] = useState(false);
  const [smtpPassword, setSmtpPassword] = useState('');
  const [account, setAccount] = useState<Account>(defaultAccount);
  const [detected, setDetected] = useState<AutoConfigResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<AccountTestResult | null>(null);
  const [done, setDone] = useState<{ oauth: OAuthProvider | null; name: string }>({ oauth: null, name: '' });

  useEffect(() => {
    if (!open) return;
    setStep('identity');
    setDisplayName('');
    setEmail('');
    setPassword('');
    setSmtpOwn(false);
    setSmtpPassword('');
    setAccount(defaultAccount());
    setDetected(null);
    setBusy(false);
    setError(null);
    setTest(null);
  }, [open]);

  const provider = detected?.oauthProvider ?? null;
  const visibleSteps = STEPS.filter((s) => s.id !== 'method' || provider);

  /** Step 1 → auto-detect server settings */
  const detect = async (): Promise<void> => {
    const mail = email.trim();
    if (!isValidEmail(mail)) {
      setError('Bitte eine gültige E-Mail-Adresse eingeben.');
      return;
    }
    setError(null);
    setBusy(true);
    let cfg: AutoConfigResult | null = null;
    try {
      cfg = await api.accounts.autoConfig(mail);
    } catch {
      cfg = null;
    }
    setBusy(false);
    const domain = mail.split('@')[1].toLowerCase();
    const base = defaultAccount();
    setAccount({
      ...base,
      name: mail,
      displayName: displayName.trim() || mail.split('@')[0],
      email: mail,
      color: colorFor(mail),
      sortOrder: accountCount,
      // Gmail / Outlook.com store sent mail themselves
      saveSent: !presetFor(mail)?.autoSent,
      imap: { host: cfg?.imap.host ?? `imap.${domain}`, port: cfg?.imap.port ?? 993, security: cfg?.imap.security ?? 'tls', user: mail },
      smtp: { host: cfg?.smtp.host ?? `smtp.${domain}`, port: cfg?.smtp.port ?? 587, security: cfg?.smtp.security ?? 'starttls', user: mail }
    });
    setDetected(cfg);
    setTest(null);
    setStep(cfg?.oauthProvider ? 'method' : 'server');
  };

  // without a separate SMTP password the backend uses the IMAP password for SMTP
  const finalAccount = (): Account => withPasswords(account, password, smtpOwn ? smtpPassword : '');

  const runTest = async (): Promise<void> => {
    const err = validateServers(account);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setTesting(true);
    setTest(null);
    try {
      setTest(await api.accounts.test(finalAccount()));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTesting(false);
    }
  };

  const savePassword = async (): Promise<void> => {
    const err = validateServers(account) ?? (password ? null : 'Bitte das Passwort eingeben.');
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const saved = await api.accounts.save({ ...finalAccount(), auth: 'password', oauthProvider: undefined });
      await refreshAccounts();
      setDone({ oauth: null, name: saved.name });
      setStep('done');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveOAuth = async (p: OAuthProvider): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const saved = await api.accounts.save({ ...withPasswords(account, '', ''), auth: 'oauth2', oauthProvider: p });
      await refreshAccounts();
      setDone({ oauth: p, name: saved.name });
      setStep('done');
      // the login completes in the system browser; report the outcome whenever it arrives
      api.accounts
        .oauthLogin(saved.id, p, saved.email)
        .then(async () => {
          toast('success', `Anmeldung bei ${providerLabel(p)} erfolgreich – ${saved.email} wird synchronisiert.`);
          await refreshAccounts();
        })
        .catch((e: unknown) => toast('error', `Anmeldung fehlgeschlagen: ${errorMessage(e)}`));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const missingClientId = provider === 'microsoft' ? !oauthSettings?.microsoftClientId : provider === 'google' ? !oauthSettings?.googleClientId : false;

  let body: JSX.Element;
  let footer: JSX.Element;

  if (step === 'identity') {
    body = (
      <form
        className="col st-wizard-form"
        onSubmit={(e) => {
          e.preventDefault();
          void detect();
        }}
      >
        <p className="muted">Geben Sie Ihre E-Mail-Adresse ein. KS Mail ermittelt die Servereinstellungen automatisch.</p>
        <Field label="Ihr Name" hint="Wird Empfängern als Absender angezeigt.">
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Max Mustermann" autoFocus />
        </Field>
        <Field label="E-Mail-Adresse">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" spellCheck={false} />
        </Field>
        <Field label="Passwort" hint="Bei Microsoft- und Google-Konten können Sie sich im nächsten Schritt auch per OAuth anmelden.">
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <button type="submit" hidden />
      </form>
    );
    footer = (
      <>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button variant="primary" onClick={() => void detect()} disabled={busy || !email.trim()} icon={busy ? <Spinner /> : undefined}>
          {busy ? 'Suche Einstellungen …' : 'Weiter'}
        </Button>
      </>
    );
  } else if (step === 'method' && provider) {
    const name = providerLabel(provider);
    body = (
      <div className="col st-wizard-form">
        <DetectedInfo detected={detected} />
        <p className="muted">Wie möchten Sie sich bei {name} anmelden?</p>
        <button type="button" className="st-choice" disabled={busy} onClick={() => void saveOAuth(provider)}>
          <LogIn size={22} />
          <span className="grow">
            <strong>Mit {name} anmelden (OAuth)</strong>
            <span className="muted small-text">Empfohlen. Die Anmeldung erfolgt sicher im Browser – KS Mail speichert kein Passwort, nur ein widerrufbares Token.</span>
          </span>
          {busy && <Spinner />}
        </button>
        <button type="button" className="st-choice" disabled={busy} onClick={() => setStep('server')}>
          <KeyRound size={22} />
          <span className="grow">
            <strong>App-Passwort verwenden</strong>
            <span className="muted small-text">
              {provider === 'google' ? 'Gmail' : 'Outlook.com'} akzeptiert ohne OAuth nicht Ihr normales Kontopasswort. Erstellen Sie in den Sicherheitseinstellungen Ihres Kontos
              (Bestätigung in zwei Schritten erforderlich) ein App-Passwort und geben Sie dieses ein.
            </span>
          </span>
        </button>
        {missingClientId && (
          <div className="st-hint small-text">
            Tipp: Falls die OAuth-Anmeldung fehlschlägt, tragen Sie unter <strong>Konten → OAuth-App-Registrierung</strong> eine eigene Client-ID ein.
          </div>
        )}
      </div>
    );
    footer = (
      <>
        <Button onClick={() => setStep('identity')} disabled={busy}>
          Zurück
        </Button>
        <Button onClick={onClose}>Abbrechen</Button>
      </>
    );
  } else if (step === 'server') {
    body = (
      <div className="col st-wizard-form">
        <DetectedInfo detected={detected} />
        <div className="st-grid-2">
          <Field label="Kontobezeichnung" hint="Name in der Ordnerliste">
            <input className="input" value={account.name} onChange={(e) => setAccount({ ...account, name: e.target.value })} />
          </Field>
          <Field label="Anzeigename (Absender)">
            <input className="input" value={account.displayName} onChange={(e) => setAccount({ ...account, displayName: e.target.value })} />
          </Field>
        </div>
        <Field label="Farbe">
          <ColorPicker value={account.color} onChange={(color) => setAccount({ ...account, color })} />
        </Field>
        <ServerFields
          kind="imap"
          value={account.imap}
          onChange={(imap) => setAccount({ ...account, imap })}
          passwordSlot={
            <Field label="Passwort" style={{ marginTop: 8 }}>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </Field>
          }
        />
        <ServerFields
          kind="smtp"
          value={account.smtp}
          onChange={(smtp) => setAccount({ ...account, smtp })}
          passwordSlot={
            <div className="col" style={{ marginTop: 8 }}>
              <Checkbox checked={smtpOwn} onChange={setSmtpOwn} label="SMTP-Server verwendet ein eigenes Passwort" />
              {smtpOwn && <input className="input" type="password" value={smtpPassword} placeholder="SMTP-Passwort" onChange={(e) => setSmtpPassword(e.target.value)} autoComplete="new-password" />}
            </div>
          }
        />
        <InvalidCertCheckbox account={account} onChange={setAccount} />
        <Checkbox checked={account.saveSent} onChange={(saveSent) => setAccount({ ...account, saveSent })} label="Kopie gesendeter Nachrichten in „Gesendete Elemente“ speichern" />
        {test && <TestResultView result={test} />}
      </div>
    );
    footer = (
      <>
        <Button onClick={() => setStep(provider ? 'method' : 'identity')} disabled={busy}>
          Zurück
        </Button>
        <span className="grow" />
        <Button icon={testing ? <Spinner /> : <Plug size={16} />} onClick={() => void runTest()} disabled={testing || busy}>
          Verbindung testen
        </Button>
        <Button variant="primary" onClick={() => void savePassword()} disabled={busy} icon={busy ? <Spinner /> : undefined}>
          Konto hinzufügen
        </Button>
      </>
    );
  } else {
    body = (
      <div className="col st-wizard-done">
        <MailCheck size={40} />
        <h3>{done.name} wurde hinzugefügt</h3>
        {done.oauth ? (
          <p className="muted">
            Ihr Browser öffnet sich jetzt mit der Anmeldeseite von {providerLabel(done.oauth)}. Melden Sie sich dort an und erteilen Sie KS Mail den Zugriff – danach startet die Synchronisierung
            automatisch. <ExternalLink size={13} style={{ verticalAlign: -2 }} />
          </p>
        ) : (
          <p className="muted">Die erste Synchronisierung läuft im Hintergrund. Nachrichten erscheinen in Kürze in der Ordnerliste.</p>
        )}
      </div>
    );
    footer = (
      <Button variant="primary" onClick={onClose}>
        Fertig
      </Button>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} title="Konto hinzufügen" width={640} footer={footer}>
      <ol className="st-steps">
        {visibleSteps.map((s, i) => {
          const cur = visibleSteps.findIndex((x) => x.id === step);
          return (
            <li key={s.id} className={clsx(i === cur && 'active', i < cur && 'done')}>
              <span className="st-step-num">{i + 1}</span>
              {s.label}
            </li>
          );
        })}
      </ol>
      {body}
      {error && <div className="st-error-box">{error}</div>}
    </Dialog>
  );
}

function DetectedInfo({ detected }: { detected: AutoConfigResult | null }): JSX.Element {
  return detected ? (
    <div className="st-hint small-text">
      <Sparkles size={14} /> Einstellungen erkannt: <strong>{detected.source}</strong>
    </div>
  ) : (
    <div className="st-hint warn small-text">Keine Einstellungen gefunden – bitte die Serverdaten Ihres Anbieters prüfen und ergänzen.</div>
  );
}
