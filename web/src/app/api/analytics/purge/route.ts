import { after } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { withSystemDb } from "@/lib/server/db";
import { purgeExpired } from "@/lib/server/analytics";
import { handler } from "@/lib/server/http";

/** POST /api/analytics/purge — apply retention now (also runnable from cron: npm run analytics:purge). */
export const POST = handler(async (request: Request) => {
  const viewer = await requireAdmin(request);
  const removed = await purgeExpired();
  after(() =>
    withSystemDb((db) =>
      db.query("INSERT INTO audit_log (team_id, actor_id, action, entity_type, data) VALUES ($1, $2, 'analytics.purge', 'analytics_events', $3)", [viewer.teamId, viewer.id, { removed }]),
    ),
  );
  return Response.json({ removed });
});
