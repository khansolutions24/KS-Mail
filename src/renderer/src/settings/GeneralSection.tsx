// "Allgemein": appearance and application behaviour.

import { Monitor, Moon, Sun } from 'lucide-react';
import type { Density, Settings, Theme } from '@shared/types';
import { isMac } from '../api/client';
import { useApp } from '../store/app';
import { ColorPicker, Switch } from '../components/ui';
import { Card, Page, Row, Segmented, Select, Slider, TextInput, update, type Opt, type SectionProps } from './common';

const ACCENTS = ['#0f6cbd', '#0078d4', '#4f6bed', '#8764b8', '#c239b3', '#e3008c', '#d13438', '#ca5010', '#986f0b', '#498205', '#107c10', '#038387', '#00666d', '#69797e'];

export function GeneralSection({ settings }: SectionProps): JSX.Element {
  const accounts = useApp((s) => s.accounts);
  const accountOptions: Opt<string | null>[] = [{ value: null, label: '(Erstes Konto)' }, ...accounts.map((a) => ({ value: a.id, label: `${a.name} <${a.email}>` }))];
  const validHex = /^#[0-9a-f]{6}$/i;

  return (
    <Page title="Allgemein" description="Darstellung und Verhalten der Anwendung.">
      <Card title="Darstellung">
        <Row label="Design">
          <Segmented<Theme>
            value={settings.theme}
            onChange={(theme) => void update({ theme })}
            options={[
              { value: 'system', label: 'System', icon: <Monitor size={14} /> },
              { value: 'light', label: 'Hell', icon: <Sun size={14} /> },
              { value: 'dark', label: 'Dunkel', icon: <Moon size={14} /> }
            ]}
          />
        </Row>
        <Row label="Akzentfarbe" hint="Für Schaltflächen, Markierungen und Hervorhebungen" stacked>
          <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
            <ColorPicker value={settings.accentColor} colors={ACCENTS} onChange={(accentColor) => void update({ accentColor })} />
            <span className="row">
              <input type="color" className="st-color-input" value={validHex.test(settings.accentColor) ? settings.accentColor : '#0f6cbd'} onChange={(e) => void update({ accentColor: e.target.value })} title="Eigene Farbe wählen" />
              <TextInput
                value={settings.accentColor}
                style={{ width: 100 }}
                spellCheck={false}
                onCommit={(v) => {
                  const hex = v.trim().startsWith('#') ? v.trim() : `#${v.trim()}`;
                  if (validHex.test(hex)) void update({ accentColor: hex.toLowerCase() });
                }}
              />
            </span>
          </div>
        </Row>
        <Row label="Dichte" hint="Abstände in Listen und Menüs">
          <Segmented<Density>
            value={settings.density}
            onChange={(density) => void update({ density })}
            options={[
              { value: 'compact', label: 'Kompakt' },
              { value: 'comfortable', label: 'Normal' },
              { value: 'spacious', label: 'Groß' }
            ]}
          />
        </Row>
        <Row label="Schriftgröße" hint="Auch über Strg/⌘ + Plus/Minus änderbar">
          <Slider value={settings.fontSize} min={11} max={20} onCommit={(fontSize) => void update({ fontSize })} format={(n) => `${n} px`} />
        </Row>
        <Row label="Sprache" hint="Die Oberfläche ist derzeit nur auf Deutsch verfügbar.">
          <Select<Settings['language']>
            value={settings.language}
            options={[
              { value: 'de', label: 'Deutsch' },
              { value: 'en', label: 'English' }
            ]}
            onChange={(language) => void update({ language })}
          />
        </Row>
      </Card>

      <Card title="Konten">
        <Row label="Standardkonto" hint="Absender für neue Nachrichten, wenn kein Ordner eines Kontos ausgewählt ist">
          <Select value={settings.defaultAccountId} options={accountOptions} onChange={(defaultAccountId) => void update({ defaultAccountId })} style={{ maxWidth: 360 }} />
        </Row>
      </Card>

      <Card title="Start und Beenden">
        <Row label="Beim Anmelden am Computer starten">
          <Switch checked={settings.launchAtLogin} onChange={(launchAtLogin) => void update({ launchAtLogin })} />
        </Row>
        <Row label="Minimiert starten" hint="Nur das Symbol im Infobereich bzw. Dock anzeigen">
          <Switch checked={settings.startMinimized} onChange={(startMinimized) => void update({ startMinimized })} />
        </Row>
        <Row label="Beim Schließen in den Infobereich minimieren" hint={isMac ? 'Unter macOS läuft die App nach dem Schließen des Fensters ohnehin weiter (Beenden mit ⌘Q).' : 'KS Mail empfängt dann weiterhin Nachrichten und Erinnerungen.'}>
          <Switch checked={settings.closeToTray} onChange={(closeToTray) => void update({ closeToTray })} />
        </Row>
      </Card>
    </Page>
  );
}
