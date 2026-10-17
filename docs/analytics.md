# Website analytics

Tracking runs on **the Surette Nexus website itself** (this app), under the analytics project
`nexus-site`. It is first-party: the tracker script, the collection endpoint and the data all live in
this app and its database. No third-party analytics service is used.

> The separate Lofty site at surette-realestate.com is **not** tracked and nothing was installed there.

## How it works

1. Every public page loads `/sdk/surette-analytics.js` asynchronously (`web/src/components/site/analytics.tsx`).
2. A consent banner asks visitors to **Allow** or say **No thanks**. In the default `opt-in` mode
   nothing is sent until a visitor allows it. Global Privacy Control and Do Not Track count as "no".
   Visitors can change their choice any time on `/privacy`.
3. Events are batched and sent to `POST /api/analytics/collect` with `sendBeacon`/`fetch`.
4. The collector validates every event against an allow-list (`web/src/lib/analytics-events.ts`),
   keeps only allow-listed properties, clamps clocks, ignores duplicates and stores the rest in
   `analytics_events`. The data class (production / synthetic / test) comes from the project, never the browser.
5. Owners see dashboards in **Portal → Analytics**; agents see engagement on their own listings.
   **Portal → Settings → Website tracking** shows whether events are arriving.

## What is collected

Page views, scroll depth (25/50/75/90%), engaged time, traffic source (referrer domain, UTM tags),
device type, searches and filters (as counts and price bands, not free text), listing card clicks and
views, saves, comparisons, map layer toggles, AI assistant use, Dual-Move calculations, and contact actions:
phone/email link clicks, form start, form submit attempts, contact and showing-request submissions.

**Never collected:** what anyone types into a form, names, emails, phone numbers, full IP addresses,
cookies, fingerprints, or cross-site identifiers. A pseudonymous visitor id is stored only after consent;
otherwise only a per-tab session id exists.

## Projects and data classes

| Project | Data class | Used for |
| --- | --- | --- |
| `nexus-site` | production | Real visitors to this website |
| `demo-site` | synthetic | The demo brokerage at `/demo-site/` and `npm run analytics:demo` |
| `e2e` | test | Automated tests |

Dashboards default to production data, and the "Not enough data yet" notice appears until there are
at least 50 sessions in the period, so small numbers aren't over-interpreted. Synthetic data can be shown
explicitly with the data-class toggle, and is always labeled.

## Dashboards

- Overview: visitors, sessions, page views, conversions, daily trend
- Funnel: visit → search → listing view → contact action → contact/showing submitted
- Top pages, landing and exit pages, sources, campaigns, devices, scroll depth
- Common page journeys
- Listing engagement (views, saves, showing requests)
- Plain-language insights that cite their period and numbers

## Retention

Each project has a retention period (default 395 days). Expired events are removed by
`npm run analytics:purge` or the button in Settings. Schedule the script daily in production.

## Tracking another page or domain

If you later add a page outside this app (for example a landing page on another host), copy the tag from
**Settings → Website tracking → Track another page or domain**, and add that page's origin to the
allowed origins of `nexus-site`. Requests from unlisted origins are rejected with 403.

## When deployed

Add the public address of the deployed site to the `nexus-site` allowed origins in Settings
(same-origin requests are always accepted, so this matters mainly for extra domains).

## Try it with synthetic data

```bash
cd web && npm run analytics:demo     # ~400 synthetic sessions into the demo-site project
```

Then open Portal → Analytics and switch the data class to "synthetic".
