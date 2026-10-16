# Run Surette Nexus on another computer

The repository is private, so the computer needs access to your GitHub account
(`AkshaySaraf17`) — or add the other person as a collaborator on GitHub
(repo → Settings → Collaborators) so they sign in with their own account.

Secrets are never in the repository; the scripts below create a fresh local `.env` on each computer.

## Option A — Docker (easiest, Mac or Windows, nothing else to install)

1. Install free tools:
   - **Mac:** install Homebrew (https://brew.sh), then
     `brew install git gh colima docker docker-compose` and `colima start`
   - **Windows:** install Git for Windows (https://git-scm.com), GitHub CLI (https://cli.github.com) and
     Docker Desktop (free for personal use) or Rancher Desktop (free, open source); start it.
2. Sign in and download the project (Windows: run these in **Git Bash**):
   ```bash
   gh auth login
   gh repo clone AkshaySaraf17/surette-nexus
   cd surette-nexus
   ```
3. Start it:
   ```bash
   scripts/docker-demo.sh
   ```
   First run builds the app and loads demo data (a few minutes). Then open http://localhost:8080.
4. Stop it: `scripts/docker-demo.sh stop`

## Option B — Development mode in VS Code (Mac)

For editing code with instant reload.

1. `brew install git gh node@22 postgresql@16` and install VS Code (https://code.visualstudio.com).
2. Download the project (same as step 2 above), then first-time setup:
   ```bash
   cd web
   cp .env.example .env
   # open web/.env and set JWT_SECRET to a random value, e.g. the output of: openssl rand -base64 48
   npm install
   cd .. && scripts/db.sh migrate
   cd web && npm run db:seed
   ```
3. Open the `surette-nexus` folder in VS Code → **Terminal → Run Task… → Start everything**
   (or run `scripts/dev.sh`). Open http://localhost:3100.

Optional free local AI for the chatbot: `brew install ollama && brew services start ollama &&
ollama pull llama3.2:3b`, then add `OLLAMA_URL="http://localhost:11434"` to `web/.env`.

## When you're done on a borrowed laptop

Sign out of GitHub so your account isn't left on it: `gh auth logout` — and in VS Code, Accounts
(bottom-left person icon) → sign out. Delete the `surette-nexus` folder if you don't want to leave a copy.

## Demo sign-ins

| Where | Email | Password |
| --- | --- | --- |
| Team portal `/portal/sign-in` | owner@surette.test | surette-owner-2026 |
| Team portal | agent@surette.test | surette-agent-2026 |
| Customer `/sign-in` | client@surette.test | surette-client-2026 |
