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

## Customer sign-in options

Customers at `/sign-in` can use email and password, or **Continue with Google**.

| Feature | How it works |
| --- | --- |
| Confirm email | Sign-up emails a confirmation link (valid 24 hours). Until it is clicked the customer can browse and use the AI assistant, but saving homes, searches, comparisons and Dual-Move plans returns `403 EMAIL_NOT_VERIFIED`. The account page has a **Resend link** button (3 per hour). |
| Forgot password | `/forgot-password` emails a reset link (valid 1 hour, works once). The page always shows the same message, so it never reveals whether an email has an account. Limited to 5 requests per hour per address and 3 per hour per email. Staff reset passwords through the owner. |
| Reset | Choosing a new password signs out every other session (each session carries a version number that the reset increases), clears any lockout and confirms the email. |
| Continue with Google | OpenID Connect with PKCE, `state` and `nonce`. The ID token's signature (Google's published keys), issuer, audience, expiry, nonce and `email_verified` are all checked. A new Google user gets a customer account with no password; an existing customer with the same email is linked. Team emails are refused (`WRONG_PORTAL`), and an email already linked to a different Google account is refused (`GOOGLE_MISMATCH`). The button only appears when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. |

Links in emails carry a random 32-byte token; only its SHA-256 hash is stored (`auth_tokens`), and a new
link cancels older ones. Emails are queued in the same database transaction and sent by the worker over
SMTP (with retries). Locally they land in **Mailpit** at http://localhost:8025 (free, `brew install mailpit`
or the `mailpit` service in Docker Compose).

**Running without email (demo):** set `ACCOUNT_EMAILS=off`. New customers are confirmed at once,
"Forgot password?" is hidden (the API answers `503 EMAIL_OFF`, the same for every email), and the owner
resets customer passwords if needed. In production, emails are also off automatically when no
`SMTP_HOST` is configured.

### Setting up "Continue with Google" (free)

1. Google Cloud Console → APIs & Services → **OAuth consent screen**: External, app name "Surette Real Estate",
   scopes `openid`, `email`, `profile`.
2. Credentials → **Create credentials → OAuth client ID** → Web application. Authorized redirect URI:
   `http://localhost:3100/api/auth/google/callback` (and `https://<your domain>/api/auth/google/callback`
   in production).
3. Put the client ID and secret in `web/.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` and restart.

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
