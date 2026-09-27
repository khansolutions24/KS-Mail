#!/bin/bash
# Startet KS Mail auf macOS im Entwicklungsmodus (Doppelklick im Finder).
cd "$(dirname "$0")" || exit 1
if [ ! -d node_modules/electron/dist ]; then
  echo "Abhängigkeiten fehlen – npm install wird ausgeführt …"
  npm install || exit 1
fi
npm run dev
