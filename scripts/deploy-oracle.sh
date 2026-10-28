#!/usr/bin/env bash
# Deploy (or update) the site on the Oracle server:  scripts/deploy-oracle.sh <server-ip>
#
# Uses deploy/oracle (website, worker, PostgreSQL + pgvector, Caddy HTTPS). The site is served at
# https://<ip-with-dashes>.sslip.io (free name, no account) until SITE_HOST in the server's .env is changed
# to a custom name (docs/operations-guide.md §7.5). Secrets are generated on the server on the
# first run and never leave it. On first deploy the demo data is loaded and every demo account gets a
# new random password, saved to DEMO-LOGINS.local.txt on this Mac (private, git-ignored).
# Re-running it updates to the latest image GitHub built from main.
set -euo pipefail
IP="${1:?Usage: scripts/deploy-oracle.sh <server-ip>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY="${SSH_KEY:-$HOME/.ssh/surette_oracle}"
HOST="${IP//./-}.sslip.io"
SSH=(ssh -i "$KEY" -o BatchMode=yes "ubuntu@$IP")

echo "→ Copying deployment files"
"${SSH[@]}" "mkdir -p ~/surette"
scp -q -i "$KEY" "$ROOT/deploy/oracle/docker-compose.yml" "$ROOT/deploy/oracle/Caddyfile" "ubuntu@$IP:surette/"

echo "→ Settings (secrets are created on the server once)"
"${SSH[@]}" "cd ~/surette && if [ ! -f .env ]; then umask 077; printf 'SITE_HOST=%s\nPOSTGRES_PASSWORD=%s\nJWT_SECRET=%s\nMETRICS_TOKEN=%s\n' '$HOST' \$(openssl rand -hex 16) \$(openssl rand -hex 32) \$(openssl rand -hex 16) > .env; fi"

echo "→ Downloading the latest site image (on the server, at low priority)"
# Unpacking the image saturates the small server's single CPU, which can drop an SSH session and
# cancel a foreground pull. So the pull runs detached on the server and we check back until it ends.
"${SSH[@]}" "cd ~/surette && rm -f pull.log && (setsid nohup nice -n 15 sh -c 'docker compose pull -q; echo PULL_EXIT=\$?' > pull.log 2>&1 < /dev/null &)"
for _ in $(seq 1 90); do
  sleep 20
  status=$("${SSH[@]}" -o ConnectTimeout=15 "grep -o 'PULL_EXIT=[0-9]*' ~/surette/pull.log 2>/dev/null" 2>/dev/null || true)
  [ -n "$status" ] && break
  printf "."
done
echo
[ "$status" = "PULL_EXIT=0" ] || { echo "Image download failed or timed out ($status). See ~/surette/pull.log on the server."; exit 1; }
"${SSH[@]}" "cd ~/surette && docker compose up -d db && docker compose run --rm migrate"

first=$("${SSH[@]}" "cd ~/surette && docker compose exec -T db psql -U surette -d surette -Atc 'SELECT count(*) FROM properties' 2>/dev/null || echo 0")
if [ "$first" = "0" ]; then
  echo "→ First deploy: loading demo data"
  "${SSH[@]}" "cd ~/surette && docker compose run --rm -e ALLOW_DEMO_SEED=1 web npx tsx --conditions=react-server scripts/seed.ts" | grep -vE "npm notice|password|surette-[a-z]+-20" || true
  echo "→ Giving the demo accounts new random passwords"
  logins=$("${SSH[@]}" "cd ~/surette && docker compose run --rm -T web node -e '
    const { randomBytes } = require(\"crypto\"); const bcrypt = require(\"bcryptjs\"); const { Pool } = require(\"pg\");
    (async () => { const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const { rows } = await pool.query(\"SELECT email, role FROM users WHERE email LIKE \$\$%@surette.test\$\$ ORDER BY role, email\");
      for (const u of rows) { const pw = randomBytes(12).toString(\"base64url\");
        await pool.query(\"UPDATE users SET password_hash = \$2, session_version = session_version + 1 WHERE email = \$1\", [u.email, await bcrypt.hash(pw, 12)]);
        console.log(u.role.padEnd(7), u.email.padEnd(34), pw); }
      await pool.end(); })();'")
  umask 077
  { echo "== Oracle server https://$HOST ($(date -u +%F)) =="; echo "$logins"; echo "Staff: https://$HOST/portal/sign-in   Customers: https://$HOST/sign-in"; echo; } >> "$ROOT/DEMO-LOGINS.local.txt"
  echo "   saved to DEMO-LOGINS.local.txt"
fi

# The site's address comes from the server's .env (e.g. after switching to a DuckDNS name).
HOST=$("${SSH[@]}" "grep -m1 '^SITE_HOST=' ~/surette/.env | cut -d= -f2")

echo "→ Starting the site"
"${SSH[@]}" "cd ~/surette && docker compose up -d --remove-orphans web worker caddy && docker image prune -f >/dev/null"

printf "→ Waiting for HTTPS"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null -m 5 "https://$HOST/api/health/ready"; then echo " ready."; echo; echo "  Live at: https://$HOST"; exit 0; fi
  printf "."; sleep 5
done
echo; echo "Not answering yet. Check: ssh -i $KEY ubuntu@$IP 'cd surette && docker compose ps && docker compose logs --tail 50'"
exit 1
