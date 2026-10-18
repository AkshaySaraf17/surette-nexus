# API

All routes are under `/api`. Responses are JSON. Errors look like
`{ "error": { "code": "VALIDATION_ERROR", "message": "...", "fields": { "field": "message" } } }`
with status 400/401/403/404/409/413/415/422/429. Authentication is the `sn_session` cookie (website) or
`Authorization: Bearer <token>` (mobile app). Cookie-authenticated writes must come from an allowed origin.

**Legend:** public · customer · staff (agent or admin) · admin

### Headers

| Header | Direction | Meaning |
| --- | --- | --- |
| `X-Request-Id` | both | Correlation id; send your own (8–128 chars) or one is generated. Quote it in support requests. |
| `Idempotency-Key` | request | On create endpoints (leads, showings, deals, drafts, documents, uploads, Dual-Move share): retries return the first response instead of creating duplicates. See [system-design.md §8](system-design.md#8-idempotency). |
| `Idempotent-Replayed: true` | response | This is a stored replay. |
| `Retry-After`, `RateLimit-Limit/Remaining/Reset` | response | On `429 RATE_LIMITED`. |

## Auth
| Route | Access | Purpose |
| --- | --- | --- |
| `POST /auth/login` | public | `{ email, password, audience: "customer" \| "staff" }` |
| `POST /auth/signup` | public | Customer account (requires privacy acknowledgement) |
| `POST /auth/logout`, `GET /auth/me`, `GET /auth/session` | any | Session management |
| `POST /auth/verify` | public | `{ token }` from the confirmation email |
| `POST /auth/verify/resend` | customer | New confirmation link (3 per hour) |
| `POST /auth/password/forgot` | public | `{ email }`; always the same answer |
| `POST /auth/password/reset` | public | `{ token, password }`; signs out other sessions |
| `GET /auth/providers` | public | `{ google: boolean }` |
| `GET /auth/google/start`, `GET /auth/google/callback` | public | Continue with Google (redirects) |

## Listings, showings, collections
| Route | Access | Purpose |
| --- | --- | --- |
| `GET /properties`, `GET /properties/[id]` | public (published) / staff (all) | Search and detail |
| `POST /properties`, `PATCH/DELETE /properties/[id]` | staff | Manage listings |
| `POST /properties/upload` | staff | Multipart photo/video upload with live progress |
| `POST /properties/import` | staff | CSV import (upsert by source reference) |
| `PATCH/DELETE /media/[id]` | staff | Cover photo, alt text, order; delete a photo |
| `GET /showings/slots`, `POST /showings` | public | Book a showing (creates a lead; consent required) |
| `GET /showings`, `PATCH /showings/[id]` | staff | Confirm / cancel |
| `/collections…` | customer + their agent | Shared collections, items, comments |

## Leads and deals
| Route | Access | Purpose |
| --- | --- | --- |
| `POST /leads` | public | Contact form (consent required, honeypot) |
| `GET /leads`, `GET/PATCH /leads/[id]`, `POST /leads/[id]/notes`, `POST /leads/[id]/convert` | staff | Work leads |
| `GET/POST /deals`, `GET/PATCH/DELETE /deals/[id]` | staff (own deals; admin all) | Deals |
| `POST/PATCH/DELETE /deals/[id]/items` | staff | Tasks and milestones |
| `POST /deals/[id]/documents`, `GET/PATCH/DELETE /deals/[id]/documents/[docId]` | staff | Upload, download, verify extracted values |
| `POST /deals/[id]/ask` | staff (own deals; admin all) | `{ question }` → answer from the deal's documents with page citations (30 per 10 min) |
| `POST /deals/[id]/drafts`, `GET /drafts`, `PATCH /drafts/[id]` | staff | Draft, approve, mark sent |
| `GET /deals/agenda` | staff | Upcoming deadlines |

## Customers
| Route | Access | Purpose |
| --- | --- | --- |
| `GET/DELETE /account` | customer | Overview; delete account (password confirmation) |
| `/account/searches`, `/account/history`, `/account/comparisons`, `/account/consent` | customer | Saved data and choices |
| `GET /account/export` | customer | Download all personal data (JSON) |
| `GET /account/deals` | customer | Client-visible deal milestones |
| `POST /dual-move/analyze` | public | Dual-Move calculation (+ optional local-AI explanation) |
| `/dual-move/scenarios…`, `POST /dual-move/share` | customer | Save scenarios; share with an agent |

## AI assistant, market, analytics
| Route | Access | Purpose |
| --- | --- | --- |
| `POST /agent/assistant` | public | Streaming AI assistant (semantic + keyword listing search) |
| `POST /agent/ops` | staff | Portal assistant |
| `GET /market` | public | Market series with provenance (FRED + government datasets, with margins of error) |
| `GET /market/datasets` | public | Government dataset provenance: agency, source file URLs, SHA-256, retrieval time |
| `POST /market/refresh` | admin | Refresh FRED now and queue a government-data refresh |
| `POST /analytics/collect` | public (SDK) | Event ingestion |
| `GET /analytics/overview` | admin | Dashboards |
| `GET /analytics/agent` | staff | Engagement on own listings |
| `GET/PATCH /analytics/projects`, `POST /analytics/purge` | admin | Projects, retention |

## Admin, team, system
| Route | Access | Purpose |
| --- | --- | --- |
| `GET /admin/dashboard` | staff | Portal home data |
| `GET /admin/users`, `PATCH /admin/users/[id]` | admin | Accounts: role, active, unlock, password reset |
| `GET /admin/audit` | admin | Audit log |
| `GET /team`, `GET /team/staff` | staff | Team members; `POST /team` (admin) adds an agent or admin |
| `/utilities…`, `/vendors/compliance`, `/maintenance`, `/vendor-portal/acknowledge` | staff / vendor link | Utilities and the landlord-dispatcher integration |
| `/webhooks…` | admin | Outgoing webhooks |
| `GET /events` | anyone (filtered) | Server-Sent Events: ids of changes the caller may see; data is re-fetched through RLS |
| `GET /health/live` | public | Liveness (process up; checks nothing external) |
| `GET /health/ready` | public | Readiness: database, migrations, pool, Redis; 503 when not ready |
| `GET /health` | public | Readiness summary + circuit-breaker states |
| `GET /metrics` | Prometheus (`METRICS_TOKEN`) | Prometheus metrics; blocked at the gateway |
