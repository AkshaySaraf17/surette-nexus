#!/usr/bin/env bash
# Refresh web/package-lock.json inside the same Linux image the Docker build and CI use.
# Run after adding or upgrading npm packages on a Mac: npm 11 on macOS can omit optional
# platform packages from the lock file, which makes `npm ci` fail on Linux (Docker, CI).
# Keeps the versions already locked; only fills in what's missing. Needs Docker (colima start).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$ROOT/.lockfile-refresh"
rm -rf "$TMP" && mkdir -p "$TMP"
cp "$ROOT/web/package.json" "$ROOT/web/package-lock.json" "$TMP/"
docker run --rm -v "$TMP:/app" -w /app node:22-bookworm-slim sh -c '
  npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null
  npm ci --ignore-scripts --dry-run >/dev/null && echo "npm ci OK on Linux"'
cp "$TMP/package-lock.json" "$ROOT/web/package-lock.json"
rm -rf "$TMP"
