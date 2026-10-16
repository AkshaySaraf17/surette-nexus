#!/usr/bin/env bash
# Refresh package-lock.json inside the same Linux image the Docker build and CI use.
# Run after adding or upgrading npm packages on a Mac: npm 11 on macOS can omit optional
# platform packages from the lock file, which makes `npm ci` fail on Linux (Docker, CI).
# Keeps the versions already locked; only fills in what's missing. Needs Docker (colima start).
#
#   scripts/refresh-lockfile.sh            # web/ and mobile/
#   scripts/refresh-lockfile.sh web        # just one
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPS=("$@")
[ ${#APPS[@]} -eq 0 ] && APPS=(web mobile)
for APP in "${APPS[@]}"; do
  TMP="$ROOT/.lockfile-refresh"
  rm -rf "$TMP" && mkdir -p "$TMP"
  cp "$ROOT/$APP/package.json" "$ROOT/$APP/package-lock.json" "$TMP/"
  # 1st try keeps every locked version; if npm still can't reconcile it, regenerate from package.json.
  if docker run --rm -v "$TMP:/app" -w /app node:22-bookworm-slim sh -c '
       npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null 2>&1 &&
       npm ci --ignore-scripts --dry-run >/dev/null 2>&1'; then
    echo "$APP: lock refreshed (versions kept)"
  else
    cp "$ROOT/$APP/package.json" "$TMP/" && rm -f "$TMP/package-lock.json"
    docker run --rm -v "$TMP:/app" -w /app node:22-bookworm-slim sh -c '
      npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null 2>&1 &&
      npm ci --ignore-scripts --dry-run >/dev/null 2>&1' || { echo "$APP: could not produce a working lock; left unchanged"; rm -rf "$TMP"; exit 1; }
    echo "$APP: lock regenerated from package.json (check version changes with git diff)"
  fi
  # Only a lock that passed `npm ci` on Linux is copied back.
  cp "$TMP/package-lock.json" "$ROOT/$APP/package-lock.json"
  rm -rf "$TMP"
done
