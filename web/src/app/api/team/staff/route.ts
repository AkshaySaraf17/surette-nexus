import { contextFor, requireStaff } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { handler } from "@/lib/server/http";

/** GET /api/team/staff — team members (for assigning leads, deals and tasks). */
export const GET = handler(async (request: Request) => {
  const viewer = await requireStaff(request);
  const staff = await withDb(contextFor(viewer), (db) =>
    db.query(`SELECT id, full_name AS "fullName", role::text AS role FROM users WHERE team_id = $1 AND role IN ('admin', 'agent') ORDER BY is_leader DESC, full_name`, [viewer.teamId]),
  );
  return Response.json({ staff });
});
