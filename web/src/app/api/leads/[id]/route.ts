import { z } from "zod";
import { contextFor, requireStaff } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { ApiError, assertUuid, handler, notFound, parseBody } from "@/lib/server/http";
import { LEAD_SELECT, toLead, type LeadRow } from "@/lib/server/leads";

export const GET = handler(async (request: Request, { params }: RouteContext<"/api/leads/[id]">) => {
  const { id } = await params;
  assertUuid(id, "Lead");
  const viewer = await requireStaff(request);
  const data = await withDb(contextFor(viewer), async (db) => {
    const lead = await db.one<LeadRow>(`${LEAD_SELECT} WHERE l.id = $1`, [id]);
    if (!lead) throw notFound("Lead");
    const notes = await db.query<{ id: string; body: string; author: string | null; created_at: Date }>(
      "SELECT n.id, n.body, u.full_name AS author, n.created_at FROM lead_notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.lead_id = $1 ORDER BY n.created_at",
      [id],
    );
    const consents = await db.query<{ purpose: string; granted: boolean; text_version: string; recorded_at: Date }>(
      "SELECT purpose::text, granted, text_version, recorded_at FROM consent_records WHERE lead_id = $1 ORDER BY recorded_at",
      [id],
    );
    return { lead: toLead(lead), notes: notes.map((n) => ({ ...n, created_at: n.created_at.toISOString() })), consents };
  });
  return Response.json(data);
});

const patchSchema = z.object({
  status: z.enum(["new", "contacted", "qualified", "nurturing", "converted", "lost"]).optional(),
  assignedAgentId: z.uuid().nullable().optional(),
  nextFollowUpOn: z.iso.date().nullable().optional(),
});

export const PATCH = handler(async (request: Request, { params }: RouteContext<"/api/leads/[id]">) => {
  const { id } = await params;
  assertUuid(id, "Lead");
  const viewer = await requireStaff(request);
  const input = await parseBody(request, patchSchema);
  if (input.assignedAgentId !== undefined && viewer.role !== "admin" && input.assignedAgentId !== viewer.id) {
    throw new ApiError(403, "FORBIDDEN", "Agents can only claim leads for themselves.");
  }
  const lead = await withDb(contextFor(viewer), async (db) => {
    const rows = await db.query(
      `UPDATE leads SET status = coalesce($2::lead_status, status),
              assigned_agent_id = CASE WHEN $3 THEN $4::uuid ELSE assigned_agent_id END,
              next_follow_up_on = CASE WHEN $5 THEN $6::date ELSE next_follow_up_on END
        WHERE id = $1 RETURNING id`,
      [id, input.status ?? null, input.assignedAgentId !== undefined, input.assignedAgentId ?? null, input.nextFollowUpOn !== undefined, input.nextFollowUpOn ?? null],
    );
    if (!rows.length) throw notFound("Lead");
    await db.query("INSERT INTO audit_log (team_id, actor_id, action, entity_type, entity_id, data) VALUES ($1, $2, 'lead.updated', 'lead', $3, $4)", [viewer.teamId, viewer.id, id, input]);
    return db.one<LeadRow>(`${LEAD_SELECT} WHERE l.id = $1`, [id]);
  });
  return Response.json({ lead: lead ? toLead(lead) : null });
});
