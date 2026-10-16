#!/usr/bin/env bash
# Start everything for local development in one terminal:  scripts/dev.sh
#   database (port 5434) · website + API (http://localhost:3100) · background worker · live updates (:3200)
# Press Ctrl+C once to stop all of them (the database keeps running; stop it with scripts/db.sh stop).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/db.sh" start
cd "$ROOT/web"
[ -d node_modules ] || npm install

# Job control gives each service its own process group, so stopping it also stops the
# helper processes it starts (Next.js spawns several).
set -m
pids=()
run() { # run <label> <command…>  — prefixes each output line with the label
  local label=$1; shift
  ( "$@" 2>&1 | sed -u "s/^/[$label] /" ) &
  pids+=($!)
}
cleanup() {
  trap - INT TERM EXIT
  echo; echo "Stopping…"
  for pid in "${pids[@]}"; do kill -TERM -- "-$pid" 2>/dev/null || true; done
  sleep 2
  for pid in "${pids[@]}"; do kill -KILL -- "-$pid" 2>/dev/null || true; done
}
trap cleanup INT TERM EXIT

NEXT_PUBLIC_REALTIME_URL=ws://localhost:3200/ws run web npm run dev
run worker npm run worker
run live npm run realtime
echo "Starting… open http://localhost:3100  (team portal: http://localhost:3100/portal/sign-in)"
wait
