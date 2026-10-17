/**
 * SYNTHETIC analytics generator for demonstrations.
 *
 * Simulates visitor sessions over the past N days and submits them through the real
 * pipeline (POST /api/analytics/collect → validation → persistence) using the
 * "demo-site" project, whose data class is fixed to `synthetic` on the server. These
 * events never appear in production reports unless "Synthetic" is selected on the dashboard.
 *
 *   npm run analytics:demo -- [--sessions 400] [--days 30] [--url http://localhost:3100]
 */
import { getPool, withSystemDb } from "../src/lib/server/db";

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const BASE = arg("url", process.env.PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const SESSIONS = Number(arg("sessions", "400"));
const DAYS = Math.min(Number(arg("days", "30")), 44);

// Seeded pseudo-random generator so runs are reproducible.
let seed = 20261015;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const id = (n = 20) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(rand() * 36)]).join("");

async function main() {
  const properties = await withSystemDb((db) => db.query<{ id: string; slug: string }>("SELECT id, slug FROM properties WHERE status IN ('active', 'pending')"));
  const agents = await withSystemDb((db) => db.query<{ id: string }>("SELECT id FROM users WHERE is_public AND role IN ('admin', 'agent')"));
  if (!properties.length) throw new Error("No listings — run npm run db:seed first.");

  const sources = [
    { referrer: null, utm: {} },
    { referrer: "www.google.com", utm: {} },
    { referrer: "www.facebook.com", utm: { source: "facebook", medium: "social", campaign: "fall-open-house" } },
    { referrer: null, utm: { source: "newsletter", medium: "email", campaign: "october-listings" } },
    { referrer: "www.zillow.com", utm: {} },
    { referrer: "www.bing.com", utm: {} },
  ];
  let sent = 0;
  let accepted = 0;
  const pending: Record<string, unknown>[] = [];
  // Batches of 25 (the collector's limit), paced to stay under its per-IP rate limit.
  const flush = async (batch: Record<string, unknown>[]) => {
    if (!batch.length) return;
    const res = await fetch(`${BASE}/api/analytics/collect`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Origin: BASE },
      body: JSON.stringify({ project: "demo-site", consent: "granted", events: batch }),
    });
    sent += batch.length;
    accepted += Number(res.headers.get("x-events-accepted") ?? 0);
    if (!res.ok && res.status !== 204) throw new Error(`Collector returned ${res.status}: ${await res.text()}`);
    await new Promise((r) => setTimeout(r, 120));
  };
  for (let s = 0; s < SESSIONS; s++) {
    const start = Date.now() - rand() * DAYS * 86_400_000;
    let t = start;
    const session = id();
    const visitor = rand() < 0.55 ? id() : null; // roughly half the demo visitors "consented"
    const src = pick(sources);
    const device = rand() < 0.58 ? "mobile" : rand() < 0.85 ? "desktop" : "tablet";
    const events: Record<string, unknown>[] = [];
    const push = (type: string, path: string, props: Record<string, unknown> = {}) => {
      t += 4_000 + rand() * 60_000;
      events.push({ event_id: crypto.randomUUID(), type, occurred_at: new Date(t).toISOString(), session_id: session, visitor_id: visitor, path, referrer_domain: src.referrer, utm: src.utm, device, props });
    };
    const landing = pick(["/", "/", "/", "/listings", `/listings/${pick(properties).slug}`, "/market"]);
    push("session_start", landing);
    push("page_view", landing, { title: "Demo page" });
    push("scroll_depth", landing, { depth: 25 });
    if (rand() < 0.6) push("scroll_depth", landing, { depth: 50 });
    // Funnel: search → detail → contact action → conversion, with realistic drop-off.
    if (rand() < 0.62) {
      push("search_submit", "/listings", { surface: pick(["hero", "listings"]), fields_used: 1 + Math.floor(rand() * 3), price_band: pick(["under_400k", "400k_600k", "600k_900k", "any"]) });
      push("page_view", "/listings", { title: "Homes" });
      push("listing_index_view", "/listings", { results: 4 + Math.floor(rand() * 5) });
      if (rand() < 0.5) push("filter_change", "/listings", { filter: pick(["city", "min_beds", "max_price", "type"]), value: pick(["any", "town", "3", "600k_900k"]) });
      if (rand() < 0.68) {
        const p = pick(properties);
        push("property_card_click", "/listings", { property_id: p.id });
        push("page_view", `/listings/${p.slug}`, { title: "Listing" });
        push("property_view", `/listings/${p.slug}`, { property_id: p.id });
        push("page_engagement", `/listings/${p.slug}`, { seconds: 20 + Math.floor(rand() * 220) });
        if (rand() < 0.25) push("property_save", `/listings/${p.slug}`, { property_id: p.id, saved: true });
        if (rand() < 0.3) {
          const action = pick(["showing_request_start", "phone_click", "form_start", "assistant_open"]);
          push(action, `/listings/${p.slug}`, action === "showing_request_start" ? { property_id: p.id } : action === "form_start" ? { form: "contact" } : action === "assistant_open" ? { surface: "floating" } : {});
          if (rand() < 0.4) push(action === "showing_request_start" ? "showing_request_submit" : "contact_submit", `/listings/${p.slug}`, action === "showing_request_start" ? { property_id: p.id, source: "website" } : { source: "contact_form" });
        }
      }
    }
    if (rand() < 0.12 && agents.length) {
      push("page_view", "/team", { title: "Team" });
      push("agent_profile_view", "/team", { agent_id: pick(agents).id });
    }
    if (rand() < 0.08) push("dual_move_calculate", "/dual-move", { scenarios: 3 });
    push("page_engagement", landing, { seconds: 5 + Math.floor(rand() * 90) });

    pending.push(...events);
    while (pending.length >= 25) await flush(pending.splice(0, 25));
  }
  await flush(pending.splice(0));
  console.log(`Submitted ${sent} synthetic events (${accepted} accepted) across ${SESSIONS} sessions to project "demo-site" (data class: synthetic).`);
}

main()
  .then(() => getPool().end())
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await getPool().end();
    process.exit(1);
  });
