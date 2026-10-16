#!/usr/bin/env bash
# Run the whole app in Docker on any computer (Mac, Linux, or Windows with Git Bash/WSL):
#   scripts/docker-demo.sh          start (first run also builds the image and loads demo data)
#   scripts/docker-demo.sh stop     stop everything (data is kept)
# Needs Docker: Colima on Mac (brew install colima docker docker-compose && colima start),
# Docker Desktop or Rancher Desktop on Windows.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

# Find Docker Compose: the "docker compose" plugin, or the standalone "docker-compose" command
# (Homebrew installs the latter; the plugin form also needs a setting in ~/.docker/config.json).
if docker compose version >/dev/null 2>&1; then
  compose() { docker compose "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
  compose() { docker-compose "$@"; }
else
  echo "Docker Compose isn't installed. On a Mac: brew install docker-compose" >&2
  exit 1
fi

if [ "${1:-}" = "stop" ]; then compose down; exit 0; fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker isn't running. Start it first (Mac: 'colima start'; Windows: open Docker Desktop)." >&2
  exit 1
fi

# Local secrets for this computer only (never committed).
if [ ! -f .env ]; then
  rnd() { openssl rand -hex "$1" 2>/dev/null || head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
  printf "JWT_SECRET=%s\nMETRICS_TOKEN=%s\nPOSTGRES_PASSWORD=%s\n" "$(rnd 32)" "$(rnd 16)" "$(rnd 12)" > .env
  echo "Created .env with random local secrets."
fi

echo "Building and starting (first time takes a few minutes)…"
compose up -d --build

printf "Waiting for the app"
until [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/api/health/ready 2>/dev/null)" = "200" ]; do printf "."; sleep 3; done
echo " ready."

# Load demo data once (only if there are no listings yet).
count=$(compose exec -T db psql -U surette -d surette -Atc "SELECT count(*) FROM properties" 2>/dev/null || echo 0)
if [ "${count:-0}" = "0" ]; then
  echo "Loading demo data (listings, photos, team, deals, government data)…"
  compose run --rm -e ALLOW_DEMO_SEED=1 --no-deps web npx tsx --conditions=react-server scripts/seed.ts 2>&1 | grep -v "npm notice"
fi

cat <<'MSG'

Surette Nexus is running:
  Website ............. http://localhost:8080
  Team portal ......... http://localhost:8080/portal/sign-in   (owner@surette.test / surette-owner-2026)
  Customer sign-in .... http://localhost:8080/sign-in          (client@surette.test / surette-client-2026)
Stop it with: scripts/docker-demo.sh stop
MSG
