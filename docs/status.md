# Feature status

Status as of 2026-10-16, on a local development setup. Test layout and latest results: [testing.md](testing.md). "Verified" means checked by an automated test or a
recorded manual run, not just written.

## Working and verified

| Feature | How it was verified |
| --- | --- |
| Separate customer (`/sign-in`) and team (`/portal/sign-in`) logins; wrong-portal refusal; lockout | Playwright `auth.spec.ts`, API smoke run |
| Customer email confirmation, forgot/reset password (emails via the worker to Mailpit) | `customer-auth.test.ts`, Playwright `account-recovery.spec.ts` |
| Continue with Google: code is tested with locally signed tokens; needs your Google OAuth client ID/secret to go live | `google-oauth.test.ts`, `customer-auth.test.ts` |
| Role boundaries (customer / agent / owner) | `rls.test.ts`, Playwright, API smoke run |
| Leads: consent required, duplicate merge, routing, portal view | API smoke run, Playwright |
| Deals: create, stage gates, rule-based deadlines, commission | `deal-rules.test.ts`, `rls.test.ts`, API smoke run |
| Deal documents: content-type check, extraction with sources, verify and apply | `analytics-documents.test.ts`, API smoke run |
| Drafts: approval required before "sent" | API smoke run |
| AI assistant: search with match reasons, relaxation, save search, fair-housing refusal | `assistant-intent.test.ts`, API smoke run |
| Dual-Move Copilot math and scenarios | `dual-move.test.ts` |
| Market data from FRED (17 series) | Live refresh run |
| Website analytics on the Surette Nexus site (`nexus-site`): consent, GPC, events stored as production | Playwright `analytics.spec.ts` |
| Demo site with synthetic data, kept separate from production | Playwright, synthetic generator run |
| Site keeps working if analytics is blocked | Playwright |
| No horizontal scrolling at phone width on the main pages | Screenshot run at 390 px |
| Shared rate limiting (Postgres store), 429 + Retry-After | `reliability.test.ts`, `platform.spec.ts` |
| Idempotency keys on create endpoints | `reliability.test.ts`, `platform.spec.ts` |
| Job queue (parallel workers, retries, dead letter, dedupe) and transactional outbox | `reliability.test.ts`; worker run locally |
| Circuit breakers on Ollama, FRED, Census, dispatcher, webhooks | `circuit-breaker.test.ts` |
| WebSocket live updates (with SSE fallback) | `platform.spec.ts`; browser checked connecting over WebSocket |
| Liveness/readiness checks, Prometheus metrics, request ids, JSON logs | `platform.spec.ts`; worker/realtime health run locally |
| Production build | `next build` passes with no warnings |
| Real government data on the dashboards (Census ACS, BLS, Census permits, FHFA), with checksums | `tests/data`, `tests/integration/gov-import`, live contract tests |
| Accessibility (WCAG 2.1 AA, automated) | `e2e/accessibility` on 15 pages |
| Capacity | `npm run test:load` against the production build (numbers in testing.md) |

## Built, not independently verified

- Docker image and the Compose stack with the nginx gateway: built and run locally; browser tests pass through the gateway.
- GitHub Actions CI passes on GitHub (quality, tests, browser tests, image build + security scan, image published).
- Kubernetes manifests, alert rules and Alertmanager routing pass their official validators (kubeconform, promtool,
  amtool) but haven't run on a real cluster yet; the deploy workflow is opt-in (`DEPLOY_ENABLED`).
- Prometheus, Grafana and Loki containers: configs validated, containers not started (disk space on the dev machine).
- Load numbers are from a laptop; re-run `npm run test:load` on staging hardware.
- Mobile app changes (port 3100, team login): type-checked, not run on a device in this round.
- Home page media: the drone footage was replaced (2026-10-16) with a cross-fading photo slideshow and full-screen
  photos that stack with native scrolling, so there is no frame-by-frame scrubbing left to stutter.

## Needs something from you

| Item | What's needed |
| --- | --- |
| More natural AI wording | Install Ollama locally and set `OLLAMA_URL` (optional; built-in answers work without it) |
| Public launch | A host, a domain, HTTPS, and a production database (see [deployment.md](deployment.md)) |
| Real listings | Add them in the portal or import a CSV/MLS export; demo listings are marked `source = demo` |
| Real team members | Add in Portal → Team & accounts (only Jeffrey Jolicoeur is seeded) |

## Not tracked

surette-realestate.com (the Lofty site) is **not** tracked, and nothing was installed or changed there.
Analytics covers only the Surette Nexus website.

## Known limitations

- Uploaded files are stored on local disk; several servers need shared storage (S3/R2).
- No distributed tracing yet (request ids correlate logs; OpenTelemetry is the next step).
- No OCR for scanned documents or images.
- Commute times, school districts and the walk index are estimates.
- Emails are drafted, not sent: staff send them from their own mail app.
