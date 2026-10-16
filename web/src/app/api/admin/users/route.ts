import { contextFor, requireAdmin } from "@/lib/server/auth";
import { withDb, withSystemDb } from "@/lib/server/db";
import { handler } from "@/lib/server/http";

/** GET /api/admin/users — team members and customer accounts (owner/admin). */
export const GET = handler(async (request: Request) => {
  const viewer = await requireAdmin(request);
  const users = await withDb(contextFor(viewer), (db) =>
    db.query(
      `SELECT id, email, full_name AS "fullName", role::text AS role, title, is_public AS "isPublic", is_leader AS "isLeader",
              is_active AS "isActive", last_login_at AS "lastLoginAt", assigned_agent_id AS "assignedAgentId", created_at AS "createdAt"
         FROM users WHERE team_id = $1 ORDER BY role, full_name`,
      [viewer.teamId],
    ),
  );
  const locked = await withSystemDb((db) => db.query<{ id: string }>("SELECT id FROM users WHERE team_id = $1 AND locked_until > now()", [viewer.teamId]));
  const lockedIds = new Set(locked.map((l) => l.id));
  return Response.json({ users: users.map((u) => ({ ...u, locked: lockedIds.has(String(u.id)) })) });
});
