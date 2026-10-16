import { contextFor, requireStaff } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { handler } from "@/lib/server/http";
import { aiStatus } from "@/lib/server/ai";
import { overview, parseRange } from "@/lib/server/analytics";

/** GET /api/admin/dashboard — the portal home: pipeline, deadlines, leads, drafts (RLS-scoped), plus a website snapshot for owners. */
export const GET = handler(async (request: Request) => {
  const viewer = await requireStaff(request);
  const ctx = contextFor(viewer);
  const data = await withDb(ctx, async (db) => {
    const listings = await db.one<{ active: number; pending: number; draft: number }>(
      `SELECT count(*) FILTER (WHERE status = 'active')::int AS active, count(*) FILTER (WHERE status = 'pending')::int AS pending,
              count(*) FILTER (WHERE status = 'draft')::int AS draft FROM properties WHERE team_id = $1`,
      [viewer.teamId],
    );
    const leads = await db.one<{ new_count: number; week: number; follow_ups_due: number }>(
      `SELECT count(*) FILTER (WHERE status = 'new')::int AS new_count,
              count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS week,
              count(*) FILTER (WHERE next_follow_up_on <= current_date AND status NOT IN ('converted', 'lost'))::int AS follow_ups_due
         FROM leads`,
    );
    const pipeline = await db.query<{ stage: string; deals: number; value_cents: number; commission_cents: number }>(
      `SELECT stage::text, count(*)::int AS deals, coalesce(sum(price_cents), 0)::bigint AS value_cents,
              coalesce(sum(floor((price_cents * commission_bps + 5000) / 10000)), 0)::bigint AS commission_cents
         FROM transactions WHERE stage NOT IN ('lost') GROUP BY stage`,
    );
    const due = await db.query<{ kind: string; title: string; due_on: string; deal_id: string; deal_title: string }>(
      `SELECT * FROM (
         SELECT 'milestone' AS kind, m.label AS title, m.due_on, t.id AS deal_id, t.title AS deal_title FROM transaction_milestones m JOIN transactions t ON t.id = m.transaction_id
          WHERE m.completed_at IS NULL AND m.due_on <= current_date + 7 AND t.stage NOT IN ('closed', 'lost')
         UNION ALL
         SELECT 'task', k.title, k.due_on, t.id, t.title FROM transaction_tasks k JOIN transactions t ON t.id = k.transaction_id
          WHERE k.status = 'open' AND k.due_on <= current_date + 7 AND t.stage NOT IN ('closed', 'lost')
       ) x ORDER BY due_on LIMIT 12`,
    );
    const recentLeads = await db.query<{ id: string; contact_name: string; source: string; status: string; created_at: Date; property: string | null }>(
      "SELECT l.id, l.contact_name, l.source::text, l.status::text, l.created_at, p.title AS property FROM leads l LEFT JOIN properties p ON p.id = l.property_id ORDER BY l.created_at DESC LIMIT 6",
    );
    const drafts = await db.one<{ n: number }>("SELECT count(*)::int AS n FROM communication_drafts WHERE status = 'draft'");
    const showings = await db.one<{ requested: number }>("SELECT count(*) FILTER (WHERE status = 'requested' AND starts_at > now())::int AS requested FROM showings");
    return { listings, leads, pipeline, due, recentLeads, drafts: drafts?.n ?? 0, showingsRequested: showings?.requested ?? 0 };
  });
  const website = viewer.role === "admin" ? (await overview(ctx, parseRange(new URL("http://x/?days=30")))).totals : null;
  return Response.json({ ...data, website, ai: await aiStatus(), role: viewer.role, today: new Date().toISOString().slice(0, 10) });
});
