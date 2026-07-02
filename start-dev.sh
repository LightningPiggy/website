#!/usr/bin/env bash
#
# start-dev.sh — one-command launcher for the LightningPiggy website.
#
# Installs dependencies on first run, then starts the Astro dev server at
# http://localhost:4321 with hot-reload. Safe to run every time; it only
# installs when needed. Works from any directory (cd's to its own folder).
#
#   Usage:  ./start-dev.sh
#
set -euo pipefail

# Always operate from the repo root (the folder this script lives in).
cd "$(dirname "$0")"

# 1. Node.js must be installed.
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js is not installed."
  echo "   Install Node 20 LTS from https://nodejs.org/ (or via nvm), then re-run this script."
  exit 1
fi

# 2. Node must be new enough for Astro 5 (>= 18.20; 20 LTS recommended).
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "❌ Node $(node -v) is too old — Astro needs Node 18.20+ (20 LTS recommended)."
  exit 1
fi
echo "✅ Using Node $(node -v)"

# 3. Install dependencies if they're missing. Use the lockfile for a clean,
#    reproducible install when one is present.
if [ ! -d node_modules ]; then
  echo "📦 Installing dependencies (first run — this can take a minute)…"
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
else
  echo "📦 Dependencies present (delete the node_modules folder to force a reinstall)."
fi

# 4. Start the dev server. exec so Ctrl+C stops it cleanly.
echo "🚀 Starting dev server → http://localhost:4321   (press Ctrl+C to stop)"
exec npm run dev
