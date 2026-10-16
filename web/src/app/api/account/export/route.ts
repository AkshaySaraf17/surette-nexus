import { contextFor, requireCustomer } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { handler } from "@/lib/server/http";

/** GET /api/account/export — everything stored for this customer, as a JSON download. */
export const GET = handler(async (request: Request) => {
  const viewer = await requireCustomer(request);
  const data = await withDb(contextFor(viewer), async (db) => ({
    exportedAt: new Date().toISOString(),
    account: viewer,
    collections: await db.query("SELECT c.name, c.created_at, ci.property_id, p.title, ci.reaction, ci.note FROM collections c LEFT JOIN collection_items ci ON ci.collection_id = c.id LEFT JOIN properties p ON p.id = ci.property_id WHERE c.owner_id = $1", [viewer.id]),
    comments: await db.query("SELECT body, created_at FROM collection_comments WHERE author_id = $1", [viewer.id]),
    savedSearches: await db.query("SELECT name, criteria, created_at FROM saved_searches"),
    searchHistory: await db.query("SELECT criteria, result_count, created_at FROM search_history"),
    comparisons: await db.query("SELECT name, property_ids, created_at FROM property_comparisons"),
    dualMoveScenarios: await db.query("SELECT name, inputs, created_at FROM dual_move_scenarios WHERE user_id = $1", [viewer.id]),
    showings: await db.query("SELECT s.starts_at, s.status, p.title FROM showings s JOIN properties p ON p.id = s.property_id WHERE s.client_user_id = $1", [viewer.id]),
    consents: await db.query("SELECT purpose, granted, text_version, recorded_at FROM consent_records WHERE user_id = $1 ORDER BY recorded_at", [viewer.id]),
  }));
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="surette-account-export.json"`, "Cache-Control": "no-store" },
  });
});
