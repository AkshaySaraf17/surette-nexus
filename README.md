# Surette Nexus

The website, property-management portal and team app for **Surette Real Estate** in Waterville, Maine.

- **Public site**: scroll-driven Apple-style design with full-screen photography, live listings, a map with school /
  commute / walkability layers, saved homes and comparisons, a **Dual-Move Copilot** (sell one home and buy
  the next), a **market dashboard** from public data, and an **AI assistant** chatbot that searches live listings,
  books showings and hands off to an agent.
- **Two sign-ins**: customers at `/sign-in` (saved homes, searches, Dual-Move plans, their deal's progress) and
  the property-management team at `/portal/sign-in`.
- **Portal** (`/admin`): dashboard, leads, a drag-and-drop **deal board** with automatic deadlines, document
  upload with value extraction, approved email drafts, showings, listings (photo upload and CSV import),
  utilities, vendors, website analytics, team accounts, settings and an "Ask ops" assistant.
- **Website analytics**: first-party and consent-based, running on this site (project `nexus-site`).
- **PostgreSQL** enforces the rules: row-level security per role, integer-cent money, an append-only audit log.
- **Team app** (Expo) for listings, photos and showings on the go.
- AI is optional and **local only** (Ollama); everything works without it. No paid APIs are required.
- **Built to scale** ([system design](docs/system-design.md)): an API gateway and load balancer, shared rate
  limiting, layered caching, idempotency keys, a Postgres job queue with a transactional outbox (event-driven),
  WebSockets, circuit breakers, tuned indexes and read replicas, health checks, JSON logs, Prometheus metrics,
  Grafana dashboards and alerts, plus Docker, Kubernetes and CI/CD.

**Full documentation is in [`docs/`](docs/README.md)**, including the [feature status](docs/status.md).

## Project layout

```
surette-nexus/
├── analytics-sdk/        Browser tracker (served at /sdk/surette-analytics.js)
├── .github/workflows/    CI (lint, types, tests, e2e, image) and CD (staging → production)
├── database/migrations/  SQL migrations (001 core · 002 platform · 005 queue/outbox · 007 customer auth · 009–010 vector search)
├── data/gov/             Real government datasets (Census, BLS, FHFA) with checksums — see its README
├── deploy/               nginx gateway · Kubernetes (kustomize) · Prometheus, Alertmanager, Grafana, Loki
├── demo-site/            Fictional brokerage used to test analytics (served at /demo-site/, synthetic data)
├── docs/                 Documentation
├── ml/                   AI service (Python: FastAPI + LlamaIndex): RAG, embeddings, evaluation
├── integrations/         Patch for the FastAPI landlord-dispatcher (not applied automatically)
├── mobile/               Expo team app
├── scripts/              dev.sh (start everything), db.sh (local Postgres), ml-setup.sh (AI service), docker-demo.sh
├── web/                  Next.js 16 app: public site, portal, API, tests (Vitest + Playwright)
├── Dockerfile · docker-compose.yml
```

## Run it locally

Requirements: Node 20+, PostgreSQL 16+ (`brew install postgresql@16`), Google Chrome for browser tests.

**First time only**

```bash
cd web
cp .env.example .env                # set JWT_SECRET (openssl rand -base64 48)
npm install
cd .. && scripts/db.sh migrate      # create the local database and tables
cd web && npm run db:seed           # demo team, accounts, listings, leads, deals, government data
```

**Every day: start everything with one command**

```bash
scripts/dev.sh                      # database + website/API + worker + live updates; Ctrl+C stops them
```

Or in VS Code: **Terminal → Run Task… → Start everything** (or `Cmd+Shift+B`). Each part opens in its
own terminal panel. Then open http://localhost:3100 (team portal: http://localhost:3100/portal/sign-in).

On another computer, or to run everything in Docker with one command: see
[docs/run-on-another-computer.md](docs/run-on-another-computer.md) (`scripts/docker-demo.sh`).

Team app: `cd mobile && npm install && npx expo start` (it talks to port 3100).

Demo accounts (local only):

| Sign in at | Role | Email | Password |
| --- | --- | --- | --- |
| `/portal/sign-in` | Owner | `owner@surette.test` | `surette-owner-2026` |
| `/portal/sign-in` | Agent | `agent@surette.test` | `surette-agent-2026` |
| `/sign-in` | Customer | `client@surette.test` | `surette-client-2026` |

`scripts/db.sh reset` wipes and re-seeds. Demo listings use fictional addresses and freely licensed photos
(see `/credits`). In production create the owner with `npm run admin:create` instead of seeding.

Useful scripts (in `web/`): `market:refresh`, `analytics:demo` (synthetic traffic), `analytics:purge`, `admin:create`.

### Optional services

- **Local AI**: install Ollama (`brew install ollama && brew services start ollama`), set
  `OLLAMA_URL=http://localhost:11434`.
- **AI search** (Ask the documents, meaning-based home search): run `scripts/ml-setup.sh` once, set
  `ML_SERVICE_URL=http://localhost:8600` in `web/.env`; `scripts/dev.sh` starts the AI service. See
  [docs/ai-assistant.md](docs/ai-assistant.md).
- **Maintenance + vendor compliance**: apply `integrations/landlord-dispatcher/website-integration.patch` to the
  dispatcher, run it, then set `DISPATCHER_API_URL` and `DISPATCHER_API_KEY` in `web/.env`.

## How the real-time upload works

1. The app or portal sends `multipart/form-data` to `POST /api/properties/upload` (`metadata` JSON + `files`).
2. Each file is streamed through **sharp** as it arrives: EXIF orientation applied, metadata stripped, and three
   WebP renditions (640/1200/2400 px) plus a blur placeholder written to storage.
3. One transaction inserts or updates the listing and its `media_assets`, as the uploader's RLS role.
4. On commit, a Postgres trigger runs `NOTIFY surette_events`. The web server's single `LISTEN` connection
   relays it over Server-Sent Events (`/api/events`) to every open browser allowed to see it.
5. Pages re-query through the API. New homes animate into the grid, and the listing page re-renders in place.

Measured locally: a two-photo upload appeared on an already-open Homes page **≈1.1 s** after the request was
sent, with zero page navigations.

## API

See [docs/api.md](docs/api.md). Errors look like `{ "error": { "code", "message", "fields"? } }`.

Webhook deliveries carry `X-Surette-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "t.body")>`. Events:
`listing.published`, `listing.updated`, `media.uploaded`, `showing.requested`, `showing.updated`, `collection.activity`.

## Tests

```bash
cd web
npm test            # 83 unit, integration, data-quality and config tests (Vitest)
npm run test:e2e    # 51 browser tests incl. accessibility + security (Playwright; run worker + realtime too)
npm run test:load   # load test against a production build (see docs/testing.md)
npm run lint && npx tsc --noEmit
cd ../mobile && npx tsc --noEmit
```

See [docs/testing.md](docs/testing.md). The dispatcher patch ships with its own pytest tests (26 pass).

## Honest limits

See [docs/status.md](docs/status.md). In short: the Docker stack runs locally and the GitHub checks run on
every push, but Kubernetes and the monitoring containers haven't run on real infrastructure yet; uploads use local disk; commute, school-district and walk-index figures are estimates; emails are
drafted, not sent automatically; surette-realestate.com (Lofty) is not tracked or modified.

## Credits

Film and photography: Wikimedia Commons (CC BY / CC BY-SA / CC0 / public domain), listed on `/credits`.
Map data © OpenStreetMap contributors, tiles by OpenFreeMap.
