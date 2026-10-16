import { requireStaff } from "@/lib/server/auth";
import { agentDashboard, parseRange } from "@/lib/server/analytics";
import { withDb } from "@/lib/server/db";
import { handler } from "@/lib/server/http";
import { contextFor } from "@/lib/server/auth";

/** GET /api/analytics/agent — engagement on the signed-in agent's own listings, and their leads. */
export const GET = handler(async (request: Request) => {
  const viewer = await requireStaff(request);
  const range = parseRange(new URL(request.url));
  const data = await agentDashboard(viewer.id, viewer.teamId, range);
  const leads = await withDb(contextFor(viewer), (db) =>
    db.query<{ status: string; n: number }>(
      "SELECT status::text, count(*)::int AS n FROM leads WHERE assigned_agent_id = $1 AND created_at >= $2 GROUP BY status",
      [viewer.id, range.from],
    ),
  );
  return Response.json({ range: { from: range.from.toISOString(), to: range.to.toISOString(), classes: range.classes }, ...data, leads });
});
