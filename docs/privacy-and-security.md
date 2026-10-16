# Privacy, fair housing and security

## Privacy

- Website analytics is opt-in by default and honours Global Privacy Control / Do Not Track
  (see [analytics.md](analytics.md)). Form contents are never captured.
- Contact and showing forms require an explicit consent checkbox; the wording and time are stored in
  `consent_records`.
- Customers can export all their data (`/account` → Export) and delete their account.
- `/privacy` explains what is stored and lets visitors change their analytics choice.
- Analytics events expire according to each project's retention period.

## Fair housing

- The concierge declines requests to filter or describe areas by protected characteristics (race,
  religion, national origin, familial status, disability, sex, etc.) and explains that it can't help with that.
- Search, scoring and lead routing never use protected characteristics.
- School-district, commute and walkability information is labeled as an estimate.

## Security controls

| Area | Control |
| --- | --- |
| Authorization | PostgreSQL row-level security plus role checks in each route |
| Sessions | Signed JWT in an HttpOnly, SameSite=Lax cookie; Secure in production |
| CSRF | Cookie-authenticated writes from foreign origins are rejected (`proxy.ts`) |
| Passwords | bcrypt; lockout after 8 failures; login and sign-up rate-limited at the gateway and in the app (shared across instances) |
| Uploads | Type checked from file content; size limits; stored outside the web root; downloads sent as attachments |
| Analytics endpoint | Size, batch and rate limits; per-project origin allow-list; property allow-list |
| Secrets | Only `NEXT_PUBLIC_ANALYTICS_*` reach the browser; database and keys stay server-side |
| AI | Local only; AI output may not introduce new dollar amounts or change dates |
| Audit | Append-only audit log for account, lead, deal, document and settings changes |
| Demo data | Seed script refuses to run in production unless explicitly forced |

Known gaps:
uploaded files are type-checked but not virus-scanned.
