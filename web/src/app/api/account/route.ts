import { z } from "zod";
import { clearedSessionCookie, contextFor, requireCustomer, verifyPassword } from "@/lib/server/auth";
import { withDb, withSystemDb } from "@/lib/server/db";
import { ApiError, handler, parseBody } from "@/lib/server/http";

/** GET /api/account — the customer's workspace summary. */
export const GET = handler(async (request: Request) => {
  const viewer = await requireCustomer(request);
  const data = await withDb(contextFor(viewer), async (db) => {
    const counts = await db.one<{ saved: number; searches: number; scenarios: number; comparisons: number }>(
      `SELECT (SELECT count(DISTINCT ci.property_id)::int FROM collection_items ci JOIN collections c ON c.id = ci.collection_id WHERE c.owner_id = $1) AS saved,
              (SELECT count(*)::int FROM saved_searches) AS searches,
              (SELECT count(*)::int FROM dual_move_scenarios WHERE user_id = $1) AS scenarios,
              (SELECT count(*)::int FROM property_comparisons) AS comparisons`,
      [viewer.id],
    );
    const consents = await db.query<{ purpose: string; granted: boolean; recorded_at: Date }>(
      "SELECT DISTINCT ON (purpose) purpose::text, granted, recorded_at FROM consent_records WHERE user_id = $1 ORDER BY purpose, recorded_at DESC",
      [viewer.id],
    );
    const agent = viewer.assignedAgentId
      ? await db.one<{ full_name: string; email: string; phone: string | null }>("SELECT full_name, email, phone FROM users WHERE id = $1", [viewer.assignedAgentId])
      : null;
    return { counts, consents, agent };
  });
  return Response.json({ user: viewer, ...data });
});

const deleteSchema = z.object({ password: z.string().min(1, "Enter your password to confirm.") });

/**
 * DELETE /api/account — permanently delete the customer account and everything stored for it
 * (collections, saved searches, history, comparisons, scenarios, consents). Inquiries already
 * sent to the team (leads) are unlinked from the account; ask the office to erase those too.
 */
export const DELETE = handler(async (request: Request) => {
  const viewer = await requireCustomer(request);
  const { password } = await parseBody(request, deleteSchema);
  const row = await withSystemDb((db) => db.one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [viewer.id]));
  if (!row || !(await verifyPassword(password, row.password_hash))) throw new ApiError(401, "INVALID_PASSWORD", "That password isn't right.", { password: "Incorrect password." });
  await withSystemDb(async (db) => {
    await db.query("INSERT INTO audit_log (team_id, actor_id, action, entity_type, entity_id) VALUES ($1, NULL, 'account.deleted_by_owner', 'user', $2)", [viewer.teamId, viewer.id]);
    await db.query("DELETE FROM users WHERE id = $1 AND role = 'client'", [viewer.id]);
  });
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearedSessionCookie() } });
});
