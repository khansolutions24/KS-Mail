<div align="center">

<img src="build/icon.png" width="96" height="96" alt="KS Mail">

# KS Mail

**E-Mail, Kalender, Kontakte, Aufgaben und Notizen in einer Desktop-App für Windows und macOS – im Stil von Outlook, komplett per Maus, Tastatur und Befehlspalette steuerbar.**

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-0078D6)
![Stack](https://img.shields.io/badge/stack-Electron%20%7C%20React%20%7C%20TypeScript-3178c6)

</div>

---

## Funktionen

**E-Mail**
- Beliebig viele Konten über IMAP/SMTP (Gmail, Outlook.com/Microsoft 365, iCloud, Yahoo, GMX, WEB.DE, T-Online, IONOS, Posteo, mailbox.org, Strato, eigene Server). Servereinstellungen werden automatisch erkannt (eingebaute Anbieterliste, Mozilla-ISPDB, MX-Einträge).
- Anmeldung per Passwort/App-Passwort oder **OAuth2** (Microsoft, Google) mit eigener App-Registrierung.
- **Push per IMAP IDLE**, inkrementeller Abgleich (CONDSTORE), Offline-Cache in SQLite; ältere Nachrichten werden bei Bedarf nachgeladen.
- Posteingang aller Konten, Ungelesen, Gekennzeichnet, Zurückgestellt, Favoriten-Ordner, Ordnerbaum mit Anlegen/Umbenennen/Löschen, Verschieben per Drag & Drop (auch zwischen Konten).
- Unterhaltungsansicht, Lesebereich rechts/unten/aus, Datumsgruppen, angeheftete Nachrichten, Kategorien (Farben), Kennzeichnung mit Fälligkeit, Zurückstellen (Snooze), QuickSteps.
- Sichere HTML-Anzeige (Sandbox ohne Skripte, strenge CSP); externe Bilder werden blockiert, bis Sie sie erlauben („Absender vertrauen“ möglich).
- Verfassen mit Formatierung, Signaturen je Konto, Vorlagen, Anhängen per Drag & Drop, eingefügten Bildern, Wichtigkeit, Lesebestätigung, Adress-Autovervollständigung, **Rückgängig senden**, **Später senden**, Entwürfe (lokal und auf dem Server), Hinweis auf vergessene Anlage, eigenes Fenster.
- **Regeln** (Absender, Empfänger, Betreff, Text, Kopfzeilen, Größe, Anhang, Wichtigkeit → Verschieben, Kopieren, Kategorisieren, Kennzeichnen, Weiterleiten, Löschen, Benachrichtigen …), blockierte/vertrauenswürdige Absender, **automatische Antworten** (Abwesenheitsnotiz).
- Lokale Suche mit Operatoren (`von:`, `an:`, `betreff:`, `hat:anhang`, `ist:ungelesen`) und Serversuche.
- Newsletter abbestellen (List-Unsubscribe), .eml importieren/speichern, Quelltext, Drucken, Benachrichtigungen, Ungelesen-Zähler im Dock/Taskleisten-Symbol, Infobereich-Symbol, Standard-Mailprogramm für `mailto:`-Links.

**Kalender** – Tag, Arbeitswoche, Woche, Monat, Agenda; Termine per Ziehen anlegen/verschieben/verlängern; Serien (täglich/wöchentlich/monatlich/jährlich, Ausnahmen); Erinnerungen; Kategorien; mehrere Kalender; `.ics` importieren/exportieren; Internetkalender abonnieren; Besprechungsanfragen senden und Einladungen aus E-Mails annehmen/ablehnen (iMIP).

**Kontakte** – Adressbuch mit Gruppen und Favoriten, automatisch gesammelte Empfänger, vCard- und CSV-Import (Outlook-Export), vCard-Export, letzte E-Mails je Kontakt.

**Aufgaben** – Listen im Stil von Microsoft To Do: Mein Tag, Wichtig, Geplant, Schritte, Fälligkeit, Erinnerung, Wiederholung, gekennzeichnete E-Mails als Aufgaben.

**Notizen** – farbige Kurznotizen mit automatischem Speichern.

**Alles steuern**
- **Befehlspalette** (`Strg+K` / `⌘K`): jeder Befehl, jeder Ordner, jede E-Mail, jeder Termin, Kontakt und jede Aufgabe per Tastatur erreichbar.
- Über 100 Befehle mit **frei belegbaren Tastenkombinationen** (Outlook-Standard vorbelegt, z. B. `Strg+N`, `Strg+R`, `Strg+Umschalt+R`, `Strg+F`, `Strg+Q`, `F9`).
- Einstellungen für Design (hell/dunkel/System, Akzentfarbe, Dichte, Schriftgröße), Lesebereich, Benachrichtigungen mit Ruhezeiten, Autostart, Minimieren in den Infobereich, Kalenderarbeitszeiten u. v. m.
- Export/Import aller Einstellungen und Daten als JSON.
- **Demo-Konto** zum Ausprobieren ohne eigenes Postfach.

Passwörter und Tokens werden mit dem Schlüsselbund des Betriebssystems verschlüsselt (Windows DPAPI bzw. macOS Keychain über Electron `safeStorage`).

## Starten

Voraussetzung: [Node.js](https://nodejs.org) 22 oder neuer.

```bash
git clone https://github.com/khansolutions24/KS-Mail.git
cd KS-Mail
npm install
npm run dev          # App mit Hot-Reload starten
```

Unter Windows genügt ein Doppelklick auf **`KS Mail starten.cmd`**, unter macOS auf **`KS Mail starten.command`**.

## Installationspakete bauen

| Plattform | Befehl | Ergebnis (`release/`) |
| --- | --- | --- |
| Windows | `npm run dist:win` | Installer (`KS-Mail-Setup-x.y.z.exe`, x64 + ARM64) und portable `.exe` |
| macOS | `npm run dist:mac` | `KS-Mail-x.y.z.dmg` und `.zip` (Universal: Apple Silicon + Intel) |

Das macOS-Paket muss auf einem Mac gebaut werden. Ohne Apple-Entwicklerzertifikat ist die App nicht signiert – beim ersten Start per Rechtsklick → „Öffnen“ bestätigen.

## Konten mit OAuth (Microsoft 365 / Gmail)

Microsoft und Google erlauben IMAP mit normalem Passwort meist nicht mehr. Zwei Möglichkeiten:

1. **App-Passwort** beim Anbieter erzeugen (Gmail: Google-Konto → Sicherheit → App-Passwörter; Outlook.com: Microsoft-Konto → Sicherheit) und als Passwort verwenden.
2. **OAuth**: eigene App registrieren und die Client-ID unter *Einstellungen → Konten → OAuth* eintragen.
   - *Microsoft (Azure Portal → App-Registrierungen)*: Plattform **„Mobile- und Desktopanwendungen“** (nicht „Web“), Umleitungs-URI `http://localhost`, unter *Authentifizierung* „Öffentliche Clientflows zulassen“ = **Ja**, API-Berechtigungen `IMAP.AccessAsUser.All`, `SMTP.Send`, `offline_access`. Meldet Microsoft `AADSTS7000218` (Client-Secret erforderlich), ist die URI unter „Web“ eingetragen – dann umstellen oder ein Client-Secret in den Einstellungen hinterlegen.
   - *Google (Cloud Console → APIs & Dienste → Anmeldedaten)*: OAuth-Client vom Typ „Desktop-App“, Scope `https://mail.google.com/`; Client-ID und Client-Secret eintragen.

## Entwicklung

| Aufgabe | Befehl |
| --- | --- |
| Typprüfung | `npm run typecheck` |
| Unit-Tests | `npm test` |
| Oberfläche im Browser (Backend über WebSocket) | `npm run dev:web` → http://localhost:5184 |
| End-to-End-Test gegen einen IMAP-Server | `npx tsx --tsconfig tsconfig.node.json scripts/integration.ts` (erwartet Dovecot auf `127.0.0.1:10143`, siehe Kopf der Datei) |
| Icons neu erzeugen | `npx electron scripts/make-icons.cjs` |

### Aufbau

```
src/shared/     Typen, RPC-Vertrag, Befehlsliste, Regeln, Serien, iCalendar, vCard (ohne Node/DOM)
src/backend/    Node-Backend: SQLite-Cache (node:sqlite), IMAP-Sync (imapflow), SMTP (nodemailer),
                OAuth, Kalender/Kontakte/Aufgaben, Demo-Konto
src/main/       Electron-Hauptprozess: Fenster, Infobereich, macOS-Menü, mailto:, Benachrichtigungen, IPC
src/preload/    Brücke zwischen Oberfläche und Backend
src/renderer/   React-Oberfläche (zustand-Stores, Module mail/calendar/contacts/tasks/notes/settings)
src/devserver/  Backend als WebSocket-Server für den Browser-Modus
```

Die Oberfläche ruft das Backend ausschließlich über `api.<bereich>.<methode>()` auf (`src/shared/api.ts`); Änderungen meldet das Backend über Ereignisse (`mail:changed`, `sync:state`, …). Alle Befehle stehen in `src/shared/commands.ts` und werden von den Modulen über `registerCommands()` bedient – so sind Menüs, Tastenkombinationen und Befehlspalette automatisch synchron.
