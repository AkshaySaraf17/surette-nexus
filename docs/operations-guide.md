# Surette Nexus — Operations Guide

Step-by-step instructions for running, sharing, hosting and maintaining the Surette Nexus website:
on a Mac, in Docker, from your Mac with a public link, and on the Oracle Cloud free server. Everything
here uses free software. No passwords or keys are written in this guide; where they live is listed in
section 2.

## 1. What runs where

| Part | What it does | Port (local) |
| --- | --- | --- |
| Website + API (Next.js) | Public site, customer accounts, staff portal (`/admin`), REST API | 3100 |
| Background worker | Jobs: market data refresh, AI indexing, emails, clean-up | 9464 (health) |
| Live updates (WebSocket) | Instant refresh in the portal; falls back to Server-Sent Events | 3200 |
| PostgreSQL + pgvector | All data, permissions (row-level security), vector search | 5434 |
| AI service (Python, `ml/`) | Document Q&A (RAG), semantic search | 8600 |
| Ollama | Local AI models (`llama3.2:3b`, `mxbai-embed-large`) | 11434 |
| Mailpit | Test inbox for sign-up and password-reset emails | 8025 |
| Market Lab dashboard (Streamlit) | Analyst view of the models | 8501 |

| Where | Address |
| --- | --- |
| Live demo (Oracle) | https://surette-demo.duckdns.org (the old https://129-213-166-31.sslip.io redirects here) |
| Local website | http://localhost:3100 |
| Staff portal | `/portal/sign-in` on either address |
| Customer sign-in | `/sign-in` |
| Code | https://github.com/AkshaySaraf17/surette-nexus |

## 2. Accounts, keys and private files

| Item | Where it is | Notes |
| --- | --- | --- |
| Demo logins (local and Oracle) | `DEMO-LOGINS.local.txt` in the project folder | Private, never committed. The passwords in the public code no longer work. |
| SSH key for the Oracle server | `~/.ssh/surette_oracle` (private) and `~/.ssh/surette_oracle.pub` (public) | Losing the private key means losing access; back it up. |
| Server secrets (database password, session key) | `~/surette/.env` on the Oracle server | Created on first deploy; never leaves the server. |
| Local settings | `web/.env` on your Mac | Never committed (git-ignored). |
| Oracle Cloud account | https://cloud.oracle.com (region US East / Ashburn) | Your login. Never upgrade to Pay As You Go unless you intend to pay. |
| GitHub | Account `AkshaySaraf17` | Commits use only your name and email. |
| Oracle API key (optional, for the retry script) | `~/.oci/config` and `~/.oci/oci_api_key.pem` | Only on your Mac. |

Never paste passwords, keys or `.env` contents into chats, emails or GitHub.

## 3. Run it on your Mac (development)

### 3.1 One-time install

1. Install Homebrew (https://brew.sh), then the free tools:

   ```bash
   brew install git gh node@22 postgresql@16 python ollama mailpit cloudflared
   brew services start ollama
   brew services start mailpit
   ```

2. Get the code:

   ```bash
   gh auth login
   gh repo clone AkshaySaraf17/surette-nexus ~/Documents/surette-nexus
   cd ~/Documents/surette-nexus/web
   cp .env.example .env
   ```

3. Edit `web/.env` and set at least `JWT_SECRET` (a long random value from `openssl rand -base64 48`).
   For the AI features also set `OLLAMA_URL="http://localhost:11434"` and
   `ML_SERVICE_URL="http://localhost:8600"`.
4. Install packages, create the database and load demo data:

   ```bash
   npm install
   cd .. && scripts/db.sh start
   cd web && npm run db:migrate && npm run db:seed
   ```

5. Optional, for the AI features (about 4 GB of downloads):

   ```bash
   cd ~/Documents/surette-nexus && scripts/ml-setup.sh
   ```

### 3.2 Start and stop

```bash
cd ~/Documents/surette-nexus && scripts/dev.sh
```

This starts the database, website, worker, live updates and (if set up) the AI service. Open
http://localhost:3100. Press **Ctrl+C** to stop. In VS Code: **Terminal → Run Build Task**
(Cmd+Shift+B) runs "Start everything".

### 3.3 Demo logins

Seeding creates an owner, an agent and a customer account (`owner@surette.test`, `agent@surette.test`,
`client@surette.test`). Their current passwords are in `DEMO-LOGINS.local.txt`. After a fresh
`npm run db:seed`, the passwords printed by the seed apply again; change them before sharing the site
(section 9.3).

## 4. Settings (`web/.env`)

| Setting | Purpose | Typical value |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection | `postgresql://surette@localhost:5434/surette` |
| `JWT_SECRET` | Signs sign-in sessions (keep secret, long, random) | `openssl rand -base64 48` |
| `PUBLIC_SITE_URL` | The site's public address (links in emails, Google sign-in) | `http://localhost:3100` locally |
| `SITE_TEAM_SLUG` | Which team the site shows | `surette` |
| `STORAGE_DIR` | Where uploaded photos and documents are stored | `.storage` |
| `OLLAMA_URL`, `OLLAMA_MODEL` | Local AI for nicer assistant wording | `http://localhost:11434`, `llama3.2:3b` |
| `ML_SERVICE_URL`, `ML_SERVICE_TOKEN` | AI service for document Q&A and semantic search | `http://localhost:8600`, empty locally |
| `OLLAMA_EMBED_MODEL` | Embedding model for vector search | `mxbai-embed-large` |
| `ACCOUNT_EMAILS` | `off` = no emails: sign-ups confirmed at once, "Forgot password?" hidden | empty locally, `off` on the demo server |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Real email sending (any provider) | empty = Mailpit locally |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | "Continue with Google" (hidden when empty) | from Google Cloud Console |
| `METRICS_TOKEN` | Protects `/api/metrics` (required in production) | random |
| `NEXT_PUBLIC_REALTIME_URL` | WebSocket address for live updates (empty = Server-Sent Events) | `ws://localhost:3200/ws` with `dev.sh` |
| `NEXT_PUBLIC_SITE_DEMO` | Demo label (badge, footer, no search indexing); `false` removes it | default on |
| `REDIS_URL` | Optional shared cache and rate limits | empty |
| `CORS_ORIGINS` | Other sites allowed to call the API | `http://localhost:8081` |

`NEXT_PUBLIC_*` values are built into the website, so changing them needs a rebuild.

## 5. Docker on your Mac (whole stack in containers)

1. Free container runtime: `brew install colima docker docker-compose docker-buildx`, then `colima start`.
2. Start everything (creates a `.env` with random secrets on first run, loads demo data):

   ```bash
   scripts/docker-demo.sh
   ```

   Open http://localhost:8080. Stop with `scripts/docker-demo.sh stop`.
3. Extras: `docker compose --profile observability up -d` (Prometheus, Grafana, Loki);
   `docker compose --profile ai up -d` (Ollama + AI service; set `ML_SERVICE_URL=http://ml:8600` and
   `ML_SERVICE_TOKEN` in `.env`).
4. **Disk warning:** Colima's virtual disk grows and can fill a small Mac disk. Stop it when not in use
   with `colima stop`, and check space with `df -h /`.

## 6. Share from your Mac with a public link (free, no account)

```bash
scripts/share.sh
```

It builds the production site, starts it with the worker and AI service, and prints a
`https://….trycloudflare.com` link. Every feature works, including local AI. The link works only while
the Mac is awake and the script runs, and it changes every time. Use `scripts/share.sh --rebuild` after
code changes.

## 7. Oracle Cloud free hosting

### 7.1 What's deployed now

| Item | Value |
| --- | --- |
| Server | `VM.Standard.E2.1.Micro` (1 CPU, 1 GB memory + 4 GB swap), Ubuntu 24.04, Ashburn AD-1 |
| Public IP | `129.213.166.31` |
| Address | https://surette-demo.duckdns.org (free DuckDNS name; HTTPS by Caddy + Let's Encrypt). The sslip.io name redirects to it (`REDIRECT_HOSTS` in the server's `.env`) |
| Network | VCN `surette-vcn`, public subnet; ingress rules TCP 22, 80, 443 |
| On the server | `~/surette/docker-compose.yml`, `Caddyfile`, `.env` (secrets) |
| Containers | `db` (PostgreSQL 17 + pgvector), `web`, `worker`, `caddy` |
| Site image | `ghcr.io/akshaysaraf17/surette-nexus:main` (built by GitHub on every push to main; public) |
| Not included | Ollama and the AI service (need ~8 GB): the assistant uses built-in answers, search uses keywords |

### 7.2 Creating a server (for reference or a new one)

1. Sign in at https://cloud.oracle.com and check the region (top right) is **US East (Ashburn)**.
2. Network: https://cloud.oracle.com/networking/vcns → **Actions → Start VCN Wizard → Create VCN with
   Internet Connectivity** → name `surette-vcn` → **Next → Create**.
3. Server: https://cloud.oracle.com/compute/instances/create
   - Image: **Canonical Ubuntu 24.04**.
   - Shape: **VM.Standard.A1.Flex** (Ampere; 2 OCPU / 12 GB is enough for the full AI) or
     **VM.Standard.E2.1.Micro** (always available in AD-1; no AI).
   - Networking: existing VCN `surette-vcn`, subnet **public subnet-surette-vcn**, **assign a public IPv4
     address: on**.
   - SSH keys: **Paste public keys** → the contents of `~/.ssh/surette_oracle.pub`.
   - Boot volume: default for the Micro; 100 GB for an A1. The free allowance is 200 GB in total.
   - **Create.** "Out of capacity" for A1 is common: try AD-1, AD-2, AD-3, a smaller size, or another time.
4. Firewall: instance → **Networking** → subnet → **Security** → **Default Security List for surette-vcn**
   → **Add Ingress Rules**: Source `0.0.0.0/0`, TCP, destination ports `80` and `443`.
5. Prepare the server (swap, Ubuntu firewall, Docker). Replace the IP:

   ```bash
   ssh -i ~/.ssh/surette_oracle ubuntu@129.213.166.31
   sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
   echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab
   sudo iptables -I INPUT 5 -p tcp --dport 80 -m state --state NEW -j ACCEPT
   sudo iptables -I INPUT 5 -p tcp --dport 443 -m state --state NEW -j ACCEPT
   sudo sh -c "iptables-save > /etc/iptables/rules.v4"
   sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
   sudo usermod -aG docker ubuntu && exit
   ```

### 7.3 Deploy and update

From your Mac, after GitHub's checks pass on main:

```bash
scripts/deploy-oracle.sh 129.213.166.31
```

It copies `deploy/oracle/*` to the server, creates secrets there on the first run, downloads the latest
site image, applies database migrations, loads demo data and sets new random demo passwords on the
first run only (saved to `DEMO-LOGINS.local.txt`), starts the containers and waits for HTTPS.

### 7.4 Everyday server commands

Connect: `ssh -i ~/.ssh/surette_oracle ubuntu@129.213.166.31`, then `cd ~/surette`.

| Task | Command (on the server, in `~/surette`) |
| --- | --- |
| Status | `docker compose ps` |
| Logs (last 100 lines) | `docker compose logs --tail 100 web worker` |
| Restart the site | `docker compose restart web worker` |
| Stop / start everything | `docker compose down` / `docker compose up -d` |
| Memory use | `free -m` and `docker stats --no-stream` |
| Disk use | `df -h /` |

**Backup** (run on your Mac; creates a compressed copy of the database):

```bash
ssh -i ~/.ssh/surette_oracle ubuntu@129.213.166.31 'cd surette && docker compose exec -T db pg_dump -U surette surette | gzip' > surette-backup-$(date +%F).sql.gz
```

**Restore** a backup into the server (replaces the data):

```bash
gunzip -c surette-backup-YYYY-MM-DD.sql.gz | ssh -i ~/.ssh/surette_oracle ubuntu@129.213.166.31 'cd surette && docker compose exec -T db psql -U surette -d surette'
```

Uploaded photos and documents live in the `storage` Docker volume on the server.

### 7.5 A custom name: surette-demo.duckdns.org (free, set up)

1. Go to https://www.duckdns.org and **sign in with GitHub**.
2. Type `surette-demo` (or another free name), click **add domain**, enter the server IP in
   **current ip**, click **update ip**.
3. Switch the site to the new name (Caddy gets a new HTTPS certificate automatically), keep the old name
   as a redirect, and let the analytics collector accept the new address:

   ```bash
   ssh -i ~/.ssh/surette_oracle ubuntu@129.213.166.31 "cd surette && sed -i 's/^SITE_HOST=.*/SITE_HOST=surette-demo.duckdns.org/' .env && echo REDIRECT_HOSTS=129-213-166-31.sslip.io >> .env && docker compose up -d"
   ssh -i ~/.ssh/surette_oracle ubuntu@129.213.166.31 "cd surette && docker compose exec -T db psql -U surette -d surette -c \"UPDATE analytics_projects SET allowed_origins = array_append(allowed_origins, 'https://surette-demo.duckdns.org')\""
   ```

   This is already done for `surette-demo.duckdns.org`.

4. Open https://surette-demo.duckdns.org (allow a minute for the certificate). If you set up Google
   sign-in, add the new address to its authorized redirect URIs.

A `.com` name costs about $10–12 a year (e.g. Cloudflare Registrar or Porkbun); point its DNS A record to
the server IP and use the same `SITE_HOST` change.

### 7.6 Moving to a bigger free server (full AI online)

When an A1 server is available (2 OCPU / 12 GB or more), create it as in 7.2, prepare it, take a backup
of the current database, deploy with `scripts/deploy-oracle.sh <new-ip>`, restore the backup, add the AI
services (`docker compose --profile ai`), then point the name (sslip or DuckDNS) to the new IP.

## 8. GitHub and automatic checks

- Every push to `main` runs: lint and type checks, unit and database tests, browser tests (with a test
  email inbox), the Python AI-service tests, a container build with a security scan, and publishes the
  site image to GitHub Packages.
- See results: https://github.com/AkshaySaraf17/surette-nexus/actions.
- Update the live site only after the checks are green (section 7.3).
- Commits are made with your name only. Run `gitleaks git --staged` before pushing to catch secrets.

## 9. Common tasks

### 9.1 Run the tests

```bash
cd web && npm test                 # unit + database tests
cd web && npm run test:e2e         # browser tests (with scripts/dev.sh running)
cd ml && .venv/bin/python -m pytest
```

### 9.2 Rebuild the Market Lab results

```bash
cd ml && .venv/bin/python -m market_lab.build
cd ml && PYTHONPATH=. .venv/bin/streamlit run market_lab/dashboard.py
```

### 9.3 Change the demo passwords

- **New staff accounts:** the owner adds them in **Portal → Team & accounts** with a starting password.
- **Resetting a password:** the owner account can reset any account's password through the admin API
  (`PATCH /api/admin/users/<id>` with `{"newPassword": "…"}`, at least 12 characters with letters and
  numbers). There's no button for it in the portal yet.
- **Customers** reset their own password with "Forgot password?" when emails are switched on.
- **Server:** a fresh database (empty `pgdata` volume) gets new random demo passwords on the next deploy.

### 9.4 Remove the demo label

Build with `NEXT_PUBLIC_SITE_DEMO=false` (Docker: `SITE_DEMO=false` in `.env`, then rebuild).

## 10. Troubleshooting

| Problem | Fix |
| --- | --- |
| Pages flash / reload constantly and won't scroll (local) | Stop the site, delete the build cache `rm -rf web/.next`, start again. |
| Mac disk full | `colima stop`; `npm cache clean --force`; check `df -h /`. |
| "Port already in use" | Something is still running: stop `scripts/dev.sh` (Ctrl+C) or find it with `lsof -i :3100`. |
| Sign-in says "too many attempts" | Rate limit: wait 15 minutes. |
| Oracle "Out of capacity" | Try other availability domains, a smaller size, another time, or the Micro shape. |
| Live site shows 502 right after deploy | The site is still starting: wait 30–60 seconds. Check `docker compose logs --tail 50 web`. |
| HTTPS certificate not issued | Ports 80/443 must be open in both the Oracle security list and the server's iptables (7.2). |
| Live site slow on first visit | Normal on the 1 GB server after a quiet period; next pages load in about a second. |
| AI assistant gives plain answers | Expected on the small server (no local AI), or when the AI's wording failed its safety check. |
| Cloudflare link stopped working | The Mac slept or `share.sh` stopped; run it again for a new link. |

## 11. Security checklist

- Never commit `web/.env`, `DEMO-LOGINS.local.txt`, `~/.oci/*` or the SSH private key.
- Change demo passwords before sharing a site; send staff logins privately.
- Keep the Oracle account on the Always Free tier (no Pay As You Go) to avoid charges.
- The site is labelled as a demo and asks search engines not to index it.
