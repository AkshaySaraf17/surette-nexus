# Testing

Every area has its own folder, and each uses the testing method that fits it.

```
web/
├── tests/                      Vitest
│   ├── unit/                   pure logic, no database or network
│   ├── integration/            against the real local PostgreSQL (RLS, queue, outbox, idempotency…)
│   ├── data/                   data-quality checks on the government datasets in data/gov/
│   ├── contract/               live checks that agency files still parse (opt-in, needs internet)
│   ├── config/                 static checks on Docker/Kubernetes/nginx/alerting configuration
│   └── helpers/
├── e2e/                        Playwright (installed Google Chrome)
│   ├── auth/                   the two sign-ins and role boundaries
│   ├── site/                   public site: home media, market dashboard, AI assistant, Dual-Move
│   ├── portal/                 property-management portal: deals, listings
│   ├── analytics/              consent, GPC, events stored with the right project/data class
│   ├── platform/               health checks, metrics, request ids, idempotency, rate limits, WebSockets
│   ├── security/               CSRF, authorization boundaries, security headers
│   └── accessibility/          axe-core WCAG 2.1 A/AA audits of public and portal pages
└── load/                       autocannon load test with pass/fail thresholds
```

## Commands

```bash
cd web
npm test                 # all Vitest suites (unit + integration + data + config); contract tests are skipped
npm run test:unit
npm run test:integration # needs the local database (scripts/db.sh start) and seed data
REDIS_URL=redis://localhost:6379 npm run test:integration   # also runs the Valkey/Redis tests (brew services start valkey)
npm run test:data
npm run test:config
npm run test:contract    # live: downloads from census.gov, bls.gov, fhfa.gov
npm run test:e2e         # all browser tests (dev server on :3100; run `npm run worker` and `npm run realtime` too, and Mailpit on :8025)
npm run test:a11y
npm run test:security
npm run test:load        # against a production build: npm run build && npx next start -p 3300
npm run lint && npx tsc --noEmit
cd ../ml && .venv/bin/python -m pytest && .venv/bin/ruff check .   # AI service
.venv/bin/python -m eval.retrieval_eval                             # search quality (needs DB + Ollama)
cd ../mobile && npx tsc --noEmit
```

## What each suite checks

| Area | Method | Files | Checks |
| --- | --- | --- | --- |
| Money, geo | Unit | `unit/money-geo` | Integer-cent parsing, commute and walk estimates |
| AI assistant | Unit + E2E | `unit/assistant-intent`, `e2e/site/assistant` | Parsing requests, fair-housing refusal, real listing links |
| Dual-Move | Unit + E2E | `unit/dual-move`, `e2e/site/dual-move` | Math against hand calculations; nothing assumed until the visitor enters numbers |
| Deals | Unit + Integration + E2E | `unit/deal-rules`, `integration/rls`, `e2e/portal/deals` | Deadlines, stage gates, commission; agents see only their deals; creating a deal in the UI |
| Listings | Unit + E2E | `unit/validation`, `e2e/portal/listings` | Partial edits change only what was sent (regression); farmhouse cover photo |
| Documents | Unit | `unit/documents` | File type from content; contract value extraction |
| Analytics | Unit + E2E | `unit/analytics-allowlist`, `e2e/analytics/tracking` | No personal data stored; opt-in, decline and GPC respected; test traffic cleaned up |
| Sign-in and roles | E2E | `e2e/auth/sign-in` | Two entrances, wrong-portal refusal, role boundaries |
| Email confirmation, password reset | Integration + E2E (Mailpit) | `integration/customer-auth`, `e2e/auth/account-recovery` | Real emails read from Mailpit; saving blocked until confirmed; links work once and expire; reset signs out other sessions; same answer for unknown emails |
| Emails switched off | Unit + E2E | `unit/account-emails`, `e2e/auth/account-recovery` | `ACCOUNT_EMAILS=off`: sign-up confirmed at once, no emails sent, Forgot password hidden, reset API refuses |
| Ask the documents (RAG) | Python unit + Integration + E2E | `ml/tests`, `integration/ai-search`, `e2e/portal/ask-documents` | Chunking keeps pages; answers must cite real passages and only use numbers found in them; prompt-injection text ignored; model failure shows passages; agents can't retrieve other agents' passages; customers refused. The E2E test runs the real pipeline (worker → embeddings → pgvector → local model) and skips where the AI service isn't configured |
| Semantic listing search | Evaluation + Integration | `ml/eval/retrieval_eval.py`, `integration/ai-search` | Recall@3, MRR and nDCG@5 on 15 hand-labelled queries (chose the embedding model); draft listings hidden from search; re-embedding only on change |
| Continue with Google | Unit + Integration + E2E | `unit/google-oauth`, `integration/customer-auth` | PKCE; ID tokens with the wrong audience, issuer, nonce, key, expiry or unverified email are refused; account linking rules; hidden until configured |
| Security | Integration + E2E | `integration/rls`, `e2e/security/api-security` | Row-level security, CSRF block, 401/403/404 boundaries, security headers |
| Accessibility | E2E (axe-core) | `e2e/accessibility/a11y` | No serious or critical WCAG 2.1 AA violations on 15 pages; the home page is audited section by section as it scrolls |
| Redis / Valkey | Integration | `integration/redis`, `integration/redis-outage` | Shared limits, shared cache and tag invalidation; site keeps working (≤ 1 s) when Redis is unreachable. Needs `REDIS_URL` |
| Docker stack | E2E through the gateway | `E2E_BASE_URL=http://localhost:8080 E2E_REALTIME_URL=ws://localhost:8080/ws npx playwright test e2e/site e2e/accessibility …` | The same tests against the production image behind nginx |
| Rate limiting | Integration + E2E | `integration/rate-limiter`, `e2e/platform/idempotency-rate-limit` | Shared counters; 429 + Retry-After |
| Idempotency | Integration + E2E | `integration/idempotency`, `e2e/platform/idempotency-rate-limit` | Replays, key reuse, in-progress, failure release |
| Queue and events | Integration | `integration/job-queue`, `integration/outbox` | SKIP LOCKED, retries, dead letter, dedupe; transactional outbox, single fan-out |
| Circuit breakers | Unit | `unit/circuit-breaker` | Open, half-open, close, timeouts, backoff |
| Health, metrics, WebSockets | E2E | `e2e/platform/*` | Liveness and readiness, Prometheus output, request ids, live updates, cross-site WebSocket refusal |
| Government data | Data + Integration + Contract | `data/gov-snapshots`, `integration/gov-import`, `contract/gov-sources` | Checksums, completeness, plausibility, documented gaps, import, tamper rejection, live formats |
| Home page media | E2E | `e2e/site/home` | Photo slideshow and scenes load; no drone media requested; no sideways scroll on phones |
| Market dashboard | E2E | `e2e/site/market` | Community profile with margins of error, gov charts, source list |
| Deployment config | Static | `config/deploy-config` | Alert rules in sync, a runbook per alert, probes on every Deployment, gateway routing |
| Capacity | Load (autocannon) | `load/smoke.load.mjs` | Throughput and p99 latency thresholds, zero errors |

## Latest results (2026-10-16, this laptop)

- Vitest: **108 passed**, 7 skipped (the live contract tests and the Redis tests, which need `REDIS_URL`).
- Playwright: **57 passed** on the dev server (with the worker, the AI service and Ollama running, and Mailpit receiving the emails).
- AI service (Python): **18 passed** (`cd ml && .venv/bin/python -m pytest`). Against the Docker stack through nginx: site, accessibility,
  health, WebSocket and security tests pass (sign-in-heavy groups must be run a minute apart: the gateway allows
  10 sign-ins per minute per address, by design).
- Load test against the production build (25 concurrent clients, 15 s each, Apple Silicon laptop,
  local Postgres, no Redis):

| Scenario | req/s | p50 | p99 | Errors |
| --- | --- | --- | --- | --- |
| Home page (HTML) | 183 | 153 ms | 205 ms | 0 |
| Listings page (HTML) | 195 | 134 ms | 162 ms | 0 |
| Listings API (cached) | 4,005 | 5 ms | 13 ms | 0 |
| Market API (cached) | 1,108 | 21 ms | 43 ms | 0 |
| Government datasets API | 3,457 | 6 ms | 10 ms | 0 |
| Readiness check | 5,055 | 4 ms | 8 ms | 0 |

Real bugs these tests found and that are now fixed:
- **Listing edits:** a partial edit reset the listing to "draft" (zod v4 keeps defaults in `.partial()`).
- **Readiness under load:** readiness failed whenever the database pool was busy, which would have pulled every pod out of the load balancer at once.
- **Dual-Move rate helper:** the "Use it" button disappeared when a field showed an error.
- **Contrast:** colors failed WCAG AA on 15 pages.
- **Analytics test cleanup:** test visits could leave events in production analytics.

The browser and load tests clean up the leads, deals and analytics events they create.
