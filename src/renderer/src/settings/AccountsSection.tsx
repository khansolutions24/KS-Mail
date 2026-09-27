// "Konten": account list (status, order, enable, edit, remove), add buttons and OAuth app registration.

import clsx from 'clsx';
import { AlertCircle, ArrowDown, ArrowUp, CheckCircle2, FlaskConical, Loader2, Pencil, Plus, Trash2, WifiOff } from 'lucide-react';
import { useState } from 'react';
import type { Account, SyncState } from '@shared/types';
import { api } from '../api/client';
import { attempt, confirm, useApp } from '../store/app';
import { Avatar, Button, Empty, IconButton, Switch } from '../components/ui';
import { Card, Page, Row, TextInput, formatDateTime, patchGroup, type SectionProps } from './common';
import { AccountEditor } from './AccountEditor';
import { useSettingsUi } from './uiState';

async function refresh(): Promise<void> {
  const s = useApp.getState();
  await attempt(() => Promise.all([s.loadAccounts(), s.loadFolders()]));
}

function Status({ account, sync }: { account: Account; sync: SyncState | undefined }): JSX.Element {
  if (!account.enabled) return <span className="st-status muted">Deaktiviert</span>;
  if (account.auth === 'oauth2' && !account.hasSecret)
    return (
      <span className="st-status warn">
        <AlertCircle size={14} /> Anmeldung erforderlich
      </span>
    );
  if (account.kind !== 'demo' && account.auth === 'password' && account.hasSecret === false)
    return (
      <span className="st-status warn">
        <AlertCircle size={14} /> Kein Passwort gespeichert
      </span>
    );
  switch (sync?.status) {
    case 'syncing':
      return (
        <span className="st-status">
          <Loader2 size={14} className="st-spin" /> Synchronisiere {sync.message ? `– ${sync.message}` : '…'}
        </span>
      );
    case 'error':
      return (
        <span className="st-status error selectable" title={sync.message}>
          <AlertCircle size={14} /> Fehler: {sync.message || 'Unbekannter Fehler'}
        </span>
      );
    case 'offline':
      return (
        <span className="st-status muted">
          <WifiOff size={14} /> Offline {sync.message && `– ${sync.message}`}
        </span>
      );
    default:
      return (
        <span className="st-status ok">
          <CheckCircle2 size={14} /> {sync?.lastSync ? `Synchronisiert ${formatDateTime(sync.lastSync)}` : 'Bereit'}
        </span>
      );
  }
}

export function AccountsSection({ settings }: SectionProps): JSX.Element {
  const accounts = useApp((s) => s.accounts);
  const sync = useApp((s) => s.sync);
  const [editing, setEditing] = useState<Account | null>(null);
  const sorted = [...accounts].sort((a, b) => a.sortOrder - b.sortOrder);

  const move = async (i: number, d: number): Promise<void> => {
    const ids = sorted.map((a) => a.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await attempt(() => api.accounts.reorder(ids));
    await refresh();
  };

  const toggle = async (a: Account, enabled: boolean): Promise<void> => {
    await attempt(() => api.accounts.save({ ...a, enabled }));
    await refresh();
  };

  const remove = async (a: Account): Promise<void> => {
    const ok = await confirm('Konto entfernen', `Soll das Konto „${a.name}“ (${a.email}) entfernt werden? Lokal gespeicherte Nachrichten dieses Kontos werden gelöscht. Auf dem Server bleibt alles erhalten.`, 'Entfernen', true);
    if (!ok) return;
    await attempt(() => api.accounts.remove(a.id), 'Konto entfernt');
    await refresh();
  };

  const addDemo = async (): Promise<void> => {
    await attempt(() => api.accounts.addDemo(), 'Demo-Konto hinzugefügt');
    await refresh();
  };

  const openWizard = (): void => useSettingsUi.setState({ wizard: true });

  return (
    <Page
      title="Konten"
      description="E-Mail-Konten hinzufügen, bearbeiten und die Reihenfolge in der Ordnerliste festlegen."
      actions={
        <>
          <Button icon={<FlaskConical size={16} />} onClick={() => void addDemo()}>
            Demo-Konto hinzufügen
          </Button>
          <Button variant="primary" icon={<Plus size={16} />} onClick={openWizard}>
            Konto hinzufügen
          </Button>
        </>
      }
    >
      <Card flush>
        {sorted.length === 0 ? (
          <Empty title="Noch kein Konto eingerichtet">
            <p>Fügen Sie ein IMAP-Konto (z. B. Gmail, Outlook.com, GMX, WEB.DE) oder zum Ausprobieren ein Demo-Konto hinzu.</p>
            <div className="row">
              <Button variant="primary" icon={<Plus size={16} />} onClick={openWizard}>
                Konto hinzufügen
              </Button>
              <Button icon={<FlaskConical size={16} />} onClick={() => void addDemo()}>
                Demo-Konto
              </Button>
            </div>
          </Empty>
        ) : (
          <ul className="st-items">
            {sorted.map((a, i) => (
              <li key={a.id} className={clsx('st-item', !a.enabled && 'disabled')}>
                <span className="st-account-color" style={{ background: a.color }} />
                <Avatar name={a.displayName || a.name} email={a.email} color={a.color} size={36} />
                <div className="grow st-item-main">
                  <div className="row st-item-title">
                    <strong className="ellipsis">{a.name}</strong>
                    {a.kind === 'demo' && <span className="chip">Demo</span>}
                    {a.auth === 'oauth2' && <span className="chip">OAuth {a.oauthProvider === 'google' ? 'Google' : 'Microsoft'}</span>}
                    {settings.defaultAccountId === a.id && <span className="chip st-chip-accent">Standard</span>}
                  </div>
                  <div className="muted small-text ellipsis">
                    {a.displayName ? `${a.displayName} · ` : ''}
                    {a.email}
                  </div>
                  <Status account={a} sync={sync[a.id]} />
                </div>
                <div className="row st-item-actions">
                  <IconButton small label="Nach oben" disabled={i === 0} onClick={() => void move(i, -1)}>
                    <ArrowUp size={16} />
                  </IconButton>
                  <IconButton small label="Nach unten" disabled={i === sorted.length - 1} onClick={() => void move(i, 1)}>
                    <ArrowDown size={16} />
                  </IconButton>
                  <span title={a.enabled ? 'Konto deaktivieren' : 'Konto aktivieren'}>
                    <Switch checked={a.enabled} onChange={(v) => void toggle(a, v)} />
                  </span>
                  <IconButton label="Bearbeiten" onClick={() => setEditing(a)}>
                    <Pencil size={16} />
                  </IconButton>
                  <IconButton label="Entfernen" onClick={() => void remove(a)}>
                    <Trash2 size={16} />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="OAuth-App-Registrierung"
        description={
          <>
            Für die Anmeldung per OAuth benötigt KS Mail eine registrierte App. Registrieren Sie eine App im Azure-Portal (App-Registrierungen, Plattform „Mobile und Desktop“) bzw. in der Google
            Cloud Console (OAuth-Client „Desktop-App“) und tragen Sie die IDs hier ein. Umleitungs-URI: <code>http://localhost</code>
          </>
        }
      >
        <Row label="Microsoft Client-ID" hint="Anwendungs-ID (Client) aus Azure">
          <TextInput value={settings.oauth.microsoftClientId} onCommit={(v) => void patchGroup('oauth', { microsoftClientId: v.trim() })} placeholder="00000000-0000-0000-0000-000000000000" spellCheck={false} style={{ width: 340 }} />
        </Row>
        <Row label="Microsoft Mandant" hint="„common“ für private und geschäftliche Konten, „consumers“ nur privat oder die Mandanten-ID">
          <TextInput value={settings.oauth.microsoftTenant} onCommit={(v) => void patchGroup('oauth', { microsoftTenant: v.trim() || 'common' })} placeholder="common" spellCheck={false} style={{ width: 340 }} />
        </Row>
        <Row label="Google Client-ID">
          <TextInput value={settings.oauth.googleClientId} onCommit={(v) => void patchGroup('oauth', { googleClientId: v.trim() })} placeholder="….apps.googleusercontent.com" spellCheck={false} style={{ width: 340 }} />
        </Row>
        <Row label="Google Client-Secret" hint="Bei Desktop-Apps von Google nicht geheim, aber erforderlich">
          <TextInput type="password" value={settings.oauth.googleClientSecret} onCommit={(v) => void patchGroup('oauth', { googleClientSecret: v.trim() })} spellCheck={false} autoComplete="off" style={{ width: 340 }} />
        </Row>
      </Card>

      <AccountEditor account={editing} onClose={() => setEditing(null)} />
    </Page>
  );
}
