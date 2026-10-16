import { z } from "zod";
import { contextFor, requireStaff } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { assertUuid, handler, notFound, parseBody } from "@/lib/server/http";
import { createTransaction } from "@/lib/server/deals";

const schema = z.object({ side: z.enum(["buyer", "seller", "dual", "lease"]).default("buyer") });

/** POST /api/leads/:id/convert — open a deal from a lead (lead → converted). */
export const POST = handler(async (request: Request, { params }: RouteContext<"/api/leads/[id]/convert">) => {
  const { id } = await params;
  assertUuid(id, "Lead");
  const viewer = await requireStaff(request);
  const input = await parseBody(request, schema);
  const ctx = contextFor(viewer);
  const lead = await withDb(ctx, (db) =>
    db.one<{ id: string; contact_name: string; contact_email: string | null; property_id: string | null; client_user_id: string | null; assigned_agent_id: string | null; title: string | null }>(
      `SELECT l.id, l.contact_name, l.contact_email, l.property_id, l.client_user_id, l.assigned_agent_id, p.title
         FROM leads l LEFT JOIN properties p ON p.id = l.property_id WHERE l.id = $1`,
      [id],
    ),
  );
  if (!lead) throw notFound("Lead");
  const deal = await createTransaction(viewer, {
    title: `${lead.contact_name}${lead.title ? ` — ${lead.title}` : ""}`,
    side: input.side,
    stage: "prospect",
    propertyId: lead.property_id,
    leadId: lead.id,
    clientUserId: lead.client_user_id,
    clientName: lead.contact_name,
    clientEmail: lead.contact_email,
    agentId: viewer.role === "admin" ? lead.assigned_agent_id ?? viewer.id : viewer.id,
  });
  await withDb(ctx, (db) => db.query("UPDATE leads SET status = 'converted' WHERE id = $1", [id]));
  return Response.json({ transactionId: deal.id }, { status: 201 });
});
