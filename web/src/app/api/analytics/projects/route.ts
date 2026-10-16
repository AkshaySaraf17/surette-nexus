import { z } from "zod";
import { contextFor, requireAdmin } from "@/lib/server/auth";
import { withDb, withSystemDb } from "@/lib/server/db";
import { handler, parseBody } from "@/lib/server/http";

/** GET/PATCH /api/analytics/projects — tracking projects, allowed origins, categories and retention (owner/admin). */
export const GET = handler(async (request: Request) => {
  const viewer = await requireAdmin(request);
  const projects = await withDb(contextFor(viewer), (db) =>
    db.query(
      `SELECT p.key, p.name, p.data_class, p.allowed_origins, p.retention_days, p.enabled_categories,
              (SELECT count(*)::int FROM analytics_events e WHERE e.project_key = p.key) AS events,
              (SELECT max(received_at) FROM analytics_events e WHERE e.project_key = p.key) AS last_event_at
         FROM analytics_projects p ORDER BY p.key`,
    ),
  );
  return Response.json({ projects });
});

const patchSchema = z.object({
  key: z.string(),
  allowedOrigins: z.array(z.url().refine((u) => /^https?:\/\/[^/]+$/.test(u), "Origins have no path, e.g. https://surette-realestate.com")).max(10).optional(),
  retentionDays: z.number().int().min(7).max(1825).optional(),
  enabledCategories: z.array(z.enum(["navigation", "engagement", "discovery", "conversion"])).optional(),
});

export const PATCH = handler(async (request: Request) => {
  const viewer = await requireAdmin(request);
  const input = await parseBody(request, patchSchema);
  // Owned-project check runs through RLS; the update itself needs the owner role (projects aren't app-writable).
  const owned = await withDb(contextFor(viewer), (db) => db.one("SELECT 1 FROM analytics_projects WHERE key = $1", [input.key]));
  if (!owned) return Response.json({ error: { code: "NOT_FOUND", message: "Project not found." } }, { status: 404 });
  await withSystemDb(async (db) => {
    await db.query(
      `UPDATE analytics_projects SET allowed_origins = coalesce($2, allowed_origins), retention_days = coalesce($3, retention_days),
              enabled_categories = coalesce($4, enabled_categories) WHERE key = $1`,
      [input.key, input.allowedOrigins ?? null, input.retentionDays ?? null, input.enabledCategories ?? null],
    );
    await db.query("INSERT INTO audit_log (team_id, actor_id, action, entity_type, entity_id, data) VALUES ($1, $2, 'analytics.project_updated', 'analytics_project', $3, $4)", [
      viewer.teamId,
      viewer.id,
      input.key,
      input,
    ]);
  });
  return Response.json({ ok: true });
});
