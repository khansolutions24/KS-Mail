// "Daten & Sicherung" and "Info".

import { Download, Eraser, FolderOpen, Keyboard, Mail, ShieldCheck, ShieldAlert, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppInfo } from '@shared/types';
import { api, isMac } from '../api/client';
import { attempt, confirm, toast, useApp } from '../store/app';
import { Button, Spinner } from '../components/ui';
import { Card, Page, Row } from './common';

function useAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    api.app
      .info()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);
  return info;
}

function platformName(p: string): string {
  if (p === 'win32') return 'Windows';
  if (p === 'darwin') return 'macOS';
  if (p === 'linux') return 'Linux';
  return p;
}

export function DataSection(): JSX.Element {
  const info = useAppInfo();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const exportAll = (): Promise<void> =>
    run('export', async () => {
      const path = await attempt(() => api.settings.exportAll());
      if (path) toast('success', `Sicherung gespeichert: ${path}`);
    });

  const importAll = (): Promise<void> =>
    run('import', async () => {
      const ok = await confirm('Sicherung importieren', 'Einstellungen, Regeln, Signaturen, Kontakte, Kalender, Aufgaben und Notizen aus einer Sicherung übernehmen? Vorhandene Einträge können dabei überschrieben werden.', 'Datei auswählen …');
      if (!ok) return;
      // the backend reports success itself (incl. the hint that passwords must be re-entered)
      const done = await attempt(() => api.settings.importAll());
      if (done) {
        const s = useApp.getState();
        await attempt(() => Promise.all([s.loadSettings(), s.loadAccounts(), s.loadFolders()]));
      }
    });

  const clearCache = (): Promise<void> =>
    run('cache', async () => {
      const ok = await confirm('Nachrichten-Cache leeren', 'Alle lokal zwischengespeicherten Nachrichten löschen? Sie werden bei der nächsten Synchronisierung erneut vom Server geladen. Konten, Einstellungen, Kontakte und Kalender bleiben erhalten.', 'Cache leeren', true);
      if (!ok) return;
      await attempt(() => api.app.clearCache());
      await attempt(() => useApp.getState().loadFolders());
    });

  return (
    <Page title="Daten & Sicherung" description="Sicherung, Wiederherstellung und lokaler Speicher.">
      <Card title="Sicherung" description="Die Sicherung enthält Einstellungen, Konten (ohne Passwörter), Regeln, Signaturen, Vorlagen, Kontakte, Kalender, Aufgaben und Notizen als JSON-Datei. Nach dem Import müssen die Passwörter neu eingegeben werden.">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Button icon={busy === 'export' ? <Spinner /> : <Download size={16} />} disabled={!!busy} onClick={() => void exportAll()}>
            Alles exportieren …
          </Button>
          <Button icon={busy === 'import' ? <Spinner /> : <Upload size={16} />} disabled={!!busy} onClick={() => void importAll()}>
            Sicherung importieren …
          </Button>
        </div>
      </Card>
      <Card title="Lokaler Speicher">
        <Row label="Datenordner" hint={info ? <span className="selectable st-mono">{info.dataDir}</span> : undefined}>
          <Button icon={<FolderOpen size={16} />} onClick={() => void attempt(() => api.app.openDataDir())}>
            Öffnen
          </Button>
        </Row>
        <Row label="Sichere Passwortspeicherung" hint={info?.secureStorage ? (isMac ? 'Passwörter und Tokens werden mit dem macOS-Schlüsselbund verschlüsselt.' : 'Passwörter und Tokens werden mit der Verschlüsselung des Betriebssystems gespeichert.') : 'Nicht verfügbar – Passwörter werden nur verschleiert (nicht verschlüsselt) im Datenordner gespeichert.'}>
          {info == null ? (
            <Spinner />
          ) : info.secureStorage ? (
            <span className="st-status ok">
              <ShieldCheck size={16} /> Ja
            </span>
          ) : (
            <span className="st-status warn">
              <ShieldAlert size={16} /> Nein
            </span>
          )}
        </Row>
        <Row label="Nachrichten-Cache leeren" hint="Lokale Kopien der Nachrichten löschen und neu synchronisieren">
          <Button icon={busy === 'cache' ? <Spinner /> : <Eraser size={16} />} disabled={!!busy} onClick={() => void clearCache()}>
            Cache leeren
          </Button>
        </Row>
      </Card>
    </Page>
  );
}

export function AboutSection(): JSX.Element {
  const info = useAppInfo();
  const mod = isMac ? '⌘' : 'Strg';
  return (
    <Page title="Info">
      <Card>
        <div className="st-about">
          <div className="st-about-logo">
            <Mail size={36} />
          </div>
          <div className="col" style={{ gap: 2 }}>
            <h2>KS Mail</h2>
            <span className="muted">
              Version {info?.version ?? '…'} · {info ? platformName(info.platform) : ''}
              {info && !info.electron ? ' (Browser-Modus)' : ''}
            </span>
          </div>
        </div>
        <p>E-Mail, Kalender, Kontakte, Aufgaben und Notizen in einer Anwendung – für Windows und macOS, lokal und ohne Cloud-Zwang.</p>
        <ul className="st-features">
          <li>Beliebig viele IMAP/SMTP-Konten inkl. Gmail und Outlook.com (OAuth), Push per IDLE</li>
          <li>Gemeinsamer Posteingang, Unterhaltungen, Kennzeichnungen, Zurückstellen, Kategorien</li>
          <li>Regeln, QuickSteps, Vorlagen, Signaturen und automatische Antworten</li>
          <li>Senden rückgängig, zeitversetztes Senden und Postausgang</li>
          <li>Kalender mit Serienterminen, Einladungen und ICS-Abos</li>
          <li>Kontakte (vCard/CSV), Aufgaben mit „Mein Tag“ und Notizen</li>
          <li>Frei belegbare Tastenkombinationen und Befehlspalette</li>
        </ul>
        <div className="st-hint small-text">
          <Keyboard size={14} /> Tipp: Mit <kbd className="kbd">{mod}</kbd> + <kbd className="kbd">K</kbd> öffnen Sie die Befehlspalette – dort ist jede Funktion per Tastatur erreichbar.
        </div>
      </Card>
    </Page>
  );
}
