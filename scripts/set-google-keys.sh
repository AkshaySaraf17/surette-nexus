#!/usr/bin/env bash
# Put the "Continue with Google" keys on the Oracle server without showing or storing them on this Mac:
#   scripts/set-google-keys.sh [server-ip]
# Asks for the OAuth Client ID and Client secret (typing hidden), writes them to ~/surette/.env on the
# server over SSH (sent on stdin, never on a command line) and restarts the website.
set -euo pipefail
IP="${1:-129.213.166.31}"
KEY="${SSH_KEY:-$HOME/.ssh/surette_oracle}"
read -r -p "Google Client ID: " CLIENT_ID
read -r -s -p "Google Client secret (hidden): " CLIENT_SECRET; echo
[[ "$CLIENT_ID" == *.apps.googleusercontent.com ]] || { echo "That doesn't look like a Client ID (…apps.googleusercontent.com)."; exit 1; }
[ -n "$CLIENT_SECRET" ] || { echo "The secret is empty."; exit 1; }
printf 'GOOGLE_CLIENT_ID=%s\nGOOGLE_CLIENT_SECRET=%s\n' "$CLIENT_ID" "$CLIENT_SECRET" |
  ssh -i "$KEY" -o BatchMode=yes "ubuntu@$IP" 'cd ~/surette && umask 077 && sed -i "/^GOOGLE_CLIENT_/d" .env && cat >> .env && docker compose up -d web >/dev/null 2>&1 && echo "Saved on the server; website restarting."'
unset CLIENT_SECRET
