# Sign-in and roles

There are **two separate entrances**:

| Entrance | URL | Who | After sign-in |
| --- | --- | --- | --- |
| Customer | `/sign-in` | Buyers, sellers, renters (`client`) | `/account` |
| Property-management team | `/portal/sign-in` | Agents (`agent`), owner/administrators (`admin`) | `/admin` |

Each entrance only accepts its own kind of account. A staff account used on the customer page (or the
reverse) gets a clear message with a link to the right page; the API returns `403 WRONG_PORTAL`.
Customers can create their own account; staff accounts are created by the owner in **Portal → Team & accounts**
(or from the command line, below). There is no public staff sign-up.

## What each role can do

| | Customer | Agent | Owner / admin |
| --- | --- | --- | --- |
| Save homes, searches, comparisons, Dual-Move plans | ✓ (own) | | |
| See their own deal's client-visible milestones | ✓ | | |
| Leads | | Own / assigned | All, can reassign |
| Deals, tasks, documents, drafts | | Own deals | All team deals |
| Listings, showings, utilities | | Team | Team |
| Website analytics | | Their listings only | Full dashboards |
| Accounts, settings, webhooks, audit log | | | ✓ |

These rules are enforced by PostgreSQL row-level security (see [database.md](database.md)) as well as in code.

## Account protection

- Passwords: bcrypt, at least 10 characters with a letter and a number.
- 8 failed attempts lock the account for 15 minutes; the owner can unlock it in Portal → Team.
- Login is rate-limited (20 attempts per 15 minutes per IP); sign-up 10 per hour.
- Deactivated accounts are signed out on their next request.
- Sessions are signed JWTs in an `HttpOnly`, `SameSite=Lax` cookie (or a Bearer token for the mobile app).

## Creating the first owner in production

```bash
cd web && npm run admin:create -- --email owner@example.com --name "Jeffrey Jolicoeur"
```

The password is prompted for (hidden) or read from `ADMIN_PASSWORD`. Nothing is hard-coded.

## Demo accounts (local development only, created by `npm run db:seed`)

| Role | Email | Password |
| --- | --- | --- |
| Owner | owner@surette.test | surette-owner-2026 |
| Agent | agent@surette.test | surette-agent-2026 |
| Customer | client@surette.test | surette-client-2026 |

The seed script refuses to run when `NODE_ENV=production` unless `ALLOW_DEMO_SEED=1` is set deliberately.
