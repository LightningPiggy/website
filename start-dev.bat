@echo off
REM start-dev.bat - one-command launcher for the LightningPiggy website (Windows).
REM Installs dependencies on first run, then starts the Astro dev server at
REM http://localhost:4321 with hot-reload. Double-click it, or run from a terminal.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install Node 20 LTS from https://nodejs.org/ then re-run this script.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do echo Using Node %%v

if not exist node_modules (
  echo Installing dependencies ^(first run - this can take a minute^)...
  if exist package-lock.json ( call npm ci ) else ( call npm install )
) else (
  echo Dependencies present ^(delete the node_modules folder to force a reinstall^).
)

echo Starting dev server -^> http://localhost:4321   ^(press Ctrl+C to stop^)
call npm run dev
