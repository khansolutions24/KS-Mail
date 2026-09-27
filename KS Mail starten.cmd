@echo off
rem Startet KS Mail im Entwicklungsmodus (Electron-Fenster mit Hot-Reload).
rem Dieses Konsolenfenster offen lassen; Schliessen beendet die App.
title KS Mail
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Abhaengigkeiten fehlen - "npm install" wird ausgefuehrt ...
  call npm install || (pause & exit /b 1)
)
call npm run dev
