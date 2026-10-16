import { contextFor, requireCustomer } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { handler } from "@/lib/server/http";

/** Search history (signed-in customers only; cleared on request). */
export const GET = handler(async (request: Request) => {
  const viewer = await requireCustomer(request);
  const history = await withDb(contextFor(viewer), (db) =>
    db.query(`SELECT id, criteria, result_count AS "resultCount", created_at AS "createdAt" FROM search_history ORDER BY created_at DESC LIMIT 50`),
  );
  return Response.json({ history });
});

export const DELETE = handler(async (request: Request) => {
  const viewer = await requireCustomer(request);
  await withDb(contextFor(viewer), (db) => db.query("DELETE FROM search_history WHERE user_id = $1", [viewer.id]));
  return new Response(null, { status: 204 });
});
