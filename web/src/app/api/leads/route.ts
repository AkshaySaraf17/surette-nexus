import { contextFor, getViewer, requireStaff } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { idempotentJson } from "@/lib/server/idempotency";
import { handler, rateLimit, validate } from "@/lib/server/http";
import { createLead, LEAD_SELECT, toLead, type LeadRow } from "@/lib/server/leads";
import { leadRequestSchema } from "@/lib/validation";

/** POST /api/leads — a visitor asks the team for help (consent required). */
export const POST = handler(async (request: Request) => {
  await rateLimit(request, "leads", 6, 60 * 60_000);
  const viewer = await getViewer(request);
  return idempotentJson(request, viewer?.id, async (raw) => {
    const input = validate(leadRequestSchema, raw);
    const lead = await createLead({
      source: input.source,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      message: input.message,
      propertyId: input.propertyId,
      clientUserId: viewer?.role === "client" ? viewer.id : null,
      preferences: input.preferences,
    });
    return Response.json({ lead: { id: lead.id, duplicate: lead.duplicate } }, { status: lead.duplicate ? 200 : 201 });
  });
});

/** GET /api/leads?status= — leads the signed-in staff member may see (RLS: admins all, agents theirs + unassigned). */
export const GET = handler(async (request: Request) => {
  const viewer = await requireStaff(request);
  const status = new URL(request.url).searchParams.get("status");
  const rows = await withDb(contextFor(viewer), (db) =>
    db.query<LeadRow>(`${LEAD_SELECT} ${status ? "WHERE l.status = $1::lead_status" : ""} ORDER BY l.created_at DESC LIMIT 300`, status ? [status] : []),
  );
  return Response.json({ leads: rows.map(toLead) });
});
