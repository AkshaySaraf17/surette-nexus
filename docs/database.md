# Database

PostgreSQL 15+ (developed on 17). No ORM: SQL lives next to the code that uses it.

## Migrations

`database/migrations/*.sql` are applied in filename order by `npm run db:migrate`
(`web/scripts/migrate.ts`). Each runs in a transaction and is recorded with a checksum in
`schema_migrations`; editing an applied migration is refused. Add a new numbered file instead.

| File | Contents |
| --- | --- |
| `001_core.sql` | Teams, users, properties, media, utility ledgers, showings, collections, webhooks, RLS, change notifications |
| `002_platform.sql` | Audit log, leads, consent, saved searches, comparisons, Dual-Move scenarios, transactions + milestones/tasks/documents, drafts, templates, analytics, market data, AI summaries |
| `003_deal_policy_columns.sql` | Deal visibility evaluated on the row's own columns (fixes agent deal creation) |
| `004_track_nexus_site.sql` | Analytics covers the Surette Nexus site only (removes the unused Lofty placeholder project) |

`scripts/db.sh reset` drops everything, re-runs all migrations and re-seeds demo data (development only).

## Row-level security

Requests run as the restricted role `surette_app` with `app.user_id`, `app.role`, `app.team_id` set per
transaction. Helper functions `app_user_id()`, `app_role()`, `app_team_id()` and `app_is_staff_of(team)`
are used by the policies. Highlights:

- Anonymous visitors: published listings only; no bills, collections, leads or password hashes.
- Customers: their own collections, searches, scenarios, consents, and deals where they are the client.
- Agents: their team's listings and showings; only their own (or assigned) leads and deals.
- Owner/admin: everything for their team.
- `audit_log` is append-only (a trigger rejects updates and deletes).

`web/tests/rls.test.ts` checks these rules against the real database.

## Money and dates

- Money is **integer cents** (`BIGINT`) with `CHECK (>= 0)`; percentages are basis points
  (650 = 6.50%). A dollar string sent where cents are expected is rejected, never rounded.
- Calendar dates are `YYYY-MM-DD` (`date`), computed in UTC by `web/src/lib/deal-rules.ts`.
