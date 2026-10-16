import { contextFor, requireAdmin } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { handler } from "@/lib/server/http";

/** GET /api/admin/audit — the append-only audit log for the team (owner/admin). */
export const GET = handler(async (request: Request) => {
  const viewer = await requireAdmin(request);
  const entries = await withDb(contextFor(viewer), (db) =>
    db.query(
      `SELECT a.id, a.action, a.entity_type AS "entityType", a.entity_id AS "entityId", a.data, u.full_name AS actor, a.created_at AS "createdAt"
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 200`,
    ),
  );
  return Response.json({ entries });
});
