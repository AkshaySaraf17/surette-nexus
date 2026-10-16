# landlord-dispatcher × Surette website

`website-integration.patch` layers the website integration onto the existing FastAPI dispatcher
(`~/Documents/landlord-dispatcher`) **without rewriting its core logic**. It was built and tested on a copy of
that repo, and `git apply --check` confirms it applies cleanly. It has **not** been applied to your repo.

```bash
cd ~/Documents/landlord-dispatcher
git apply --stat ~/Documents/surette-nexus/integrations/landlord-dispatcher/website-integration.patch   # preview
git apply ~/Documents/surette-nexus/integrations/landlord-dispatcher/website-integration.patch
pip install -r requirements-dev.txt && pytest                                                        # 26 passed
```

Then re-run `supabase_schema.sql` in Supabase (adds `acknowledged_at`, `vendor_eta`, `source` columns) and set the
new variables in `.env` (see `.env.example`).

## What changes

| File | Change |
| --- | --- |
| `app/main.py` | `CORSMiddleware` limited to `ALLOWED_ORIGINS` (no wildcards). Error handlers: malformed JSON → **400**, invalid fields → **422** with per-field messages, all errors keep `detail` and add `{error:{code,message,fields}}`. Supabase calls capped at `DB_TIMEOUT_SECONDS` with the existing fallbacks (mock vendor, unpersisted ticket). Missing Gemini key still → clean **503**. New `GET /api/v1/vendors/compliance` and `POST /api/v1/tickets/{ref}/acknowledge`. |
| `app/models/schemas.py` | `TenantMessage` validates phone numbers (10–15 digits) and non-empty descriptions, and accepts `source: "website"`. New `VendorCompliance`, `ComplianceReport`, `AckRequest/Response`. `VendorEmail.portal_link`. |
| `app/services/notifications.py` | Dispatch email includes a **signed vendor-portal link** so the contractor can click to confirm receipt. |
| `app/services/portal.py` (new) | Allowed origins, `X-Dispatcher-Key` check, HMAC-SHA256 link signing/verification. |
| `app/services/database.py` | `compliance_status()` (Compliant / Expiring ≤ 30 days / Expired / Missing COI / Inactive), `list_vendor_compliance()` with mock fallback, `acknowledge_ticket()`. |
| `supabase_schema.sql` | `acknowledged_at`, `vendor_eta`, `source` on `maintenance_tickets`. |
| `tests/test_website_integration.py` (new) | 13 tests: CORS allow/deny, 400 vs 422, 503 without Gemini, portal link signature, compliance feed + API key, status rules, bad signature, DB-down acknowledgement, slow-database fallback under 1.5 s. |

## How the website uses it

- **Tenant intake** (`/maintenance` on the site): the browser posts to the site's own `/api/maintenance`, which
  validates and rate-limits, then calls `POST /api/v1/tenant-alert` server-to-server with `"source": "website"`.
  The client's *existing* website can instead call the dispatcher directly from the browser, because CORS now
  allows its origins.
- **Vendor compliance** (`/admin/vendors`): the portal calls `/api/vendors/compliance` → dispatcher
  `GET /api/v1/vendors/compliance` with `X-Dispatcher-Key`, and refreshes every minute.
- **Vendor portal** (`/vendor-portal/confirm?ticket=…&vendor=…&sig=…`): the link in each dispatch email opens this
  page, and the contractor's confirmation is verified and stored by the dispatcher.

Verified locally: with the dispatcher running and no Gemini key, the site's maintenance form returns a clean
"temporarily unavailable — call the office" 503 instead of hanging, and the compliance board renders the
dispatcher's mock vendors.
