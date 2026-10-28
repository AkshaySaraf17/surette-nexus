#!/usr/bin/env bash
# Share the site from this Mac with a public link (free Cloudflare quick tunnel, no account):
#   scripts/share.sh            build if needed, start everything, print the https://….trycloudflare.com link
#   scripts/share.sh --rebuild  rebuild the website first (after code changes)
#
# The link works while this Mac is awake and this script is running (Ctrl+C stops everything).
# The link changes each time. Demo logins: DEMO-LOGINS.local.txt (private; never commit or post it).
# Needs: brew install cloudflared · scripts/ml-setup.sh once (for AI search; optional).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$ROOT/.share-logs"
mkdir -p "$LOGS"
command -v cloudflared >/dev/null || { echo "Install the tunnel first: brew install cloudflared"; exit 1; }
"$ROOT/scripts/db.sh" start

cd "$ROOT/web"
if [ "${1:-}" = "--rebuild" ] || [ ! -f .next/BUILD_ID ]; then
  # No NEXT_PUBLIC_REALTIME_URL: live updates use Server-Sent Events, which pass through the tunnel.
  env -u NEXT_PUBLIC_REALTIME_URL npm run build
fi

# A fresh token for the web app ↔ AI service on each start (never stored).
export ML_SERVICE_TOKEN="$(openssl rand -hex 24)"
export NODE_ENV=production

set -m
pids=()
start() { local name=$1; shift; ( "$@" >"$LOGS/$name.log" 2>&1 ) & pids+=($!); }
cleanup() {
  trap - INT TERM EXIT
  echo; echo "Stopping…"
  for pid in "${pids[@]}"; do kill -TERM -- "-$pid" 2>/dev/null || true; done
  sleep 2
  for pid in "${pids[@]}"; do kill -KILL -- "-$pid" 2>/dev/null || true; done
}
trap cleanup INT TERM EXIT

if [ -x "$ROOT/ml/.venv/bin/uvicorn" ]; then
  start ai bash -c "cd '$ROOT/ml' && ML_ENV=production exec .venv/bin/uvicorn surette_ml.app:app --host 127.0.0.1 --port 8600"
fi
start web npm run start
start worker npm run worker:prod

printf "Starting the website"
until curl -s -o /dev/null -m 3 http://localhost:3100/api/health/ready; do printf "."; sleep 2; done
echo " ready."

start tunnel cloudflared tunnel --no-autoupdate --url http://localhost:3100
url=""
for _ in $(seq 1 60); do
  url=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOGS/tunnel.log" | head -1 || true)
  [ -n "$url" ] && break
  sleep 1
done
[ -n "$url" ] || { echo "The tunnel didn't start; see $LOGS/tunnel.log"; exit 1; }

cat <<EOF

  Public link ......... $url
  Staff portal ........ $url/portal/sign-in
  Logins .............. $ROOT/DEMO-LOGINS.local.txt (private)

  Keep this window open and the Mac awake. Ctrl+C stops the site.
EOF
wait
