// "E-Mail": every option of settings.mail plus blocked / safe sender lists.

import type { Settings } from '@shared/types';
import { isValidEmail } from '@shared/util';
import { Switch } from '../components/ui';
import { Card, NumberInput, Page, Row, Segmented, Select, Slider, StringList, patchGroup, update, type Opt, type SectionProps } from './common';

type Mail = Settings['mail'];

const FONTS: Opt<string>[] = [
  { value: 'Segoe UI, -apple-system, Helvetica, Arial, sans-serif', label: 'System (Segoe UI / San Francisco)' },
  { value: 'Calibri, Carlito, sans-serif', label: 'Calibri' },
  { value: 'Aptos, Calibri, sans-serif', label: 'Aptos' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: 'Helvetica, Arial, sans-serif', label: 'Helvetica' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
  { value: 'Tahoma, Geneva, sans-serif', label: 'Tahoma' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: "'Times New Roman', Times, serif", label: 'Times New Roman' },
  { value: "Consolas, 'Courier New', monospace", label: 'Consolas (Festbreite)' }
];

const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24];

function senderError(s: string): string | null {
  // accepts a full address, "@domain.tld" or "domain.tld"
  const domain = s.replace(/^@/, '');
  if (isValidEmail(s) || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return null;
  return 'Bitte eine E-Mail-Adresse oder Domain (z. B. @example.com) eingeben.';
}

/** A bare domain is stored as "@domain" (the notation the backend and reading pane match against) */
function normalizeSenders(list: string[]): string[] {
  return [...new Set(list.map((s) => (s.includes('@') ? s : `@${s}`)))].sort();
}

export function MailSection({ settings }: SectionProps): JSX.Element {
  const m = settings.mail;
  const set = (patch: Partial<Mail>): void => void patchGroup('mail', patch);
  const markMode = m.markReadAfter < 0 ? 'never' : m.markReadAfter === 0 ? 'now' : 'after';
  const fonts = FONTS.some((f) => f.value === m.composeFont) ? FONTS : [...FONTS, { value: m.composeFont, label: m.composeFont }];
  const sizes = SIZES.includes(m.composeFontSize) ? SIZES : [...SIZES, m.composeFontSize].sort((a, b) => a - b);
  const sigOptions: Opt<string | null>[] = [{ value: null, label: '(Keine)' }, ...settings.signatures.map((s) => ({ value: s.id, label: s.name }))];

  return (
    <Page title="E-Mail" description="Lesen, Verfassen und Sicherheit von Nachrichten.">
      <Card title="Lesen">
        <Row label="Lesebereich">
          <Segmented<Mail['readingPane']>
            value={m.readingPane}
            onChange={(readingPane) => set({ readingPane })}
            options={[
              { value: 'right', label: 'Rechts' },
              { value: 'bottom', label: 'Unten' },
              { value: 'off', label: 'Aus' }
            ]}
          />
        </Row>
        <Row label="Als gelesen markieren">
          <div className="row">
            <Select<'never' | 'now' | 'after'>
              value={markMode}
              options={[
                { value: 'now', label: 'Sofort beim Öffnen' },
                { value: 'after', label: 'Nach einer Wartezeit' },
                { value: 'never', label: 'Nie (nur manuell)' }
              ]}
              onChange={(v) => set({ markReadAfter: v === 'never' ? -1 : v === 'now' ? 0 : 5 })}
            />
            {markMode === 'after' && <NumberInput value={m.markReadAfter} min={1} max={600} width={72} suffix="Sekunden" onCommit={(markReadAfter) => set({ markReadAfter })} />}
          </div>
        </Row>
        <Row label="Unterhaltungsansicht" hint="Nachrichten eines Verlaufs gruppieren">
          <Switch checked={m.conversationView} onChange={(conversationView) => set({ conversationView })} />
        </Row>
        <Row label="Vorschautext in der Nachrichtenliste">
          <Switch checked={m.showSnippet} onChange={(showSnippet) => set({ showSnippet })} />
        </Row>
        <Row label="Relevanter Posteingang" hint="Posteingang in „Relevant“ und „Sonstige“ aufteilen">
          <Switch checked={m.focusedInbox} onChange={(focusedInbox) => set({ focusedInbox })} />
        </Row>
        <Row label="Nach dem Löschen oder Verschieben">
          <Select<Mail['autoAdvance']>
            value={m.autoAdvance}
            options={[
              { value: 'next', label: 'Nächste Nachricht öffnen' },
              { value: 'previous', label: 'Vorherige Nachricht öffnen' },
              { value: 'list', label: 'Zur Nachrichtenliste zurückkehren' }
            ]}
            onChange={(autoAdvance) => set({ autoAdvance })}
          />
        </Row>
        <Row label="Löschen bestätigen">
          <Switch checked={m.confirmDelete} onChange={(confirmDelete) => set({ confirmDelete })} />
        </Row>
        <Row label="„Gelöschte Elemente“ beim Beenden leeren">
          <Switch checked={m.emptyTrashOnExit} onChange={(emptyTrashOnExit) => set({ emptyTrashOnExit })} />
        </Row>
      </Card>

      <Card title="Verfassen">
        <Row label="Nachrichtenformat">
          <Segmented<Mail['composeFormat']>
            value={m.composeFormat}
            onChange={(composeFormat) => set({ composeFormat })}
            options={[
              { value: 'html', label: 'HTML' },
              { value: 'text', label: 'Nur Text' }
            ]}
          />
        </Row>
        <Row label="Standardschriftart">
          <div className="row">
            <Select value={m.composeFont} options={fonts} onChange={(composeFont) => set({ composeFont })} style={{ maxWidth: 260 }} />
            <Select value={m.composeFontSize} options={sizes.map((n) => ({ value: n, label: `${n} pt` }))} onChange={(composeFontSize) => set({ composeFontSize })} />
          </div>
        </Row>
        <Row label="Vorschau" stacked>
          <div className="st-font-preview" style={{ fontFamily: m.composeFont, fontSize: `${m.composeFontSize}pt` }}>
            Sehr geehrte Damen und Herren, vielen Dank für Ihre Nachricht.
          </div>
        </Row>
        <Row label="Beim Antworten">
          <Select<Mail['replyQuotePosition']>
            value={m.replyQuotePosition}
            options={[
              { value: 'top', label: 'Über dem Originaltext schreiben' },
              { value: 'bottom', label: 'Unter dem Originaltext schreiben' }
            ]}
            onChange={(replyQuotePosition) => set({ replyQuotePosition })}
          />
        </Row>
        <Row label="Senden rückgängig machen" hint="So lange wird eine Nachricht zurückgehalten, bevor sie tatsächlich gesendet wird">
          <Slider value={m.undoSendSeconds} min={0} max={30} onCommit={(undoSendSeconds) => set({ undoSendSeconds })} format={(n) => (n === 0 ? 'Aus' : `${n} s`)} />
        </Row>
        <Row label="Empfänger automatisch als Kontakte sammeln" hint="Adressen, an die Sie schreiben, werden für die Autovervollständigung gespeichert">
          <Switch checked={m.collectRecipients} onChange={(collectRecipients) => set({ collectRecipients })} />
        </Row>
        <Row label="Standardsignatur" hint="Kann pro Konto überschrieben werden (Konten → Bearbeiten)">
          <Select value={m.defaultSignatureId} options={sigOptions} onChange={(defaultSignatureId) => set({ defaultSignatureId })} />
        </Row>
        <Row label="Signatur auch bei Antworten und Weiterleitungen">
          <Switch checked={m.signatureOnReply} onChange={(signatureOnReply) => set({ signatureOnReply })} />
        </Row>
      </Card>

      <Card title="Datenschutz und Sicherheit">
        <Row label="Externe Bilder laden" hint="Externe Bilder können verraten, dass und wann Sie eine Nachricht gelesen haben">
          <Select<Mail['remoteImages']>
            value={m.remoteImages}
            options={[
              { value: 'never', label: 'Nie' },
              { value: 'ask', label: 'Nachfragen' },
              { value: 'contacts', label: 'Nur von Kontakten und sicheren Absendern' },
              { value: 'always', label: 'Immer' }
            ]}
            onChange={(remoteImages) => set({ remoteImages })}
          />
        </Row>
        <Row label="Lesebestätigungen senden">
          <Select<Mail['sendReadReceipts']>
            value={m.sendReadReceipts}
            options={[
              { value: 'never', label: 'Nie senden' },
              { value: 'ask', label: 'Jedes Mal fragen' },
              { value: 'always', label: 'Immer senden' }
            ]}
            onChange={(sendReadReceipts) => set({ sendReadReceipts })}
          />
        </Row>
      </Card>

      <Card title="Blockierte Absender" description="Nachrichten dieser Adressen oder Domains werden automatisch in den Junk-E-Mail-Ordner verschoben.">
        <StringList items={settings.blockedSenders} onChange={(l) => void update({ blockedSenders: normalizeSenders(l) })} placeholder="spam@example.com oder @example.com" validate={senderError} empty="Keine blockierten Absender." />
      </Card>

      <Card title="Sichere Absender" description="Externe Bilder in Nachrichten dieser Adressen oder Domains werden immer automatisch geladen.">
        <StringList items={settings.safeSenders} onChange={(l) => void update({ safeSenders: normalizeSenders(l) })} placeholder="kollege@firma.de oder @firma.de" validate={senderError} empty="Keine sicheren Absender." />
      </Card>
    </Page>
  );
}
