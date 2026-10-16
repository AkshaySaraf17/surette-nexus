import { z } from "zod";
import { contextFor, requireStaff } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { mailtoLink } from "@/lib/server/drafts";
import { ApiError, assertUuid, handler, notFound, parseBody } from "@/lib/server/http";

const schema = z.object({
  action: z.enum(["save", "approve", "mark_sent", "discard"]),
  to: z.email().trim().toLowerCase().nullable().optional(),
  subject: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(10000).optional(),
});

/**
 * PATCH /api/drafts/:id — edit, approve, mark as sent (after you sent it yourself), or discard.
 * Editing an approved draft returns it to "draft" so the final text is always what was approved.
 * Surette Nexus has no email provider configured, so it never claims a message was delivered.
 */
export const PATCH = handler(async (request: Request, { params }: RouteContext<"/api/drafts/[id]">) => {
  const { id } = await params;
  assertUuid(id, "Draft");
  const viewer = await requireStaff(request);
  const input = await parseBody(request, schema);
  const result = await withDb(contextFor(viewer), async (db) => {
    const current = await db.one<{ status: string; transaction_id: string | null; to_email: string | null; subject: string; body: string }>(
      "SELECT status::text, transaction_id, to_email, subject, body FROM communication_drafts WHERE id = $1",
      [id],
    );
    if (!current) throw notFound("Draft");
    if (current.status === "sent_manually" || current.status === "discarded") throw new ApiError(409, "CLOSED", "This draft is closed.");
    const edited = input.subject !== undefined || input.body !== undefined || input.to !== undefined;
    let status = current.status;
    if (input.action === "approve") status = "approved";
    if (input.action === "discard") status = "discarded";
    if (input.action === "mark_sent") {
      if (current.status !== "approved" || edited) throw new ApiError(409, "NOT_APPROVED", "Approve the final text before marking it sent.");
      status = "sent_manually";
    }
    if (input.action === "save" && edited) status = "draft";
    const row = await db.one<{ to_email: string | null; subject: string; body: string; status: string }>(
      `UPDATE communication_drafts SET to_email = coalesce($2, to_email), subject = coalesce($3, subject), body = coalesce($4, body),
              status = $5::draft_status,
              approved_by = CASE WHEN $5 = 'approved' THEN $6::uuid WHEN $5 = 'draft' THEN NULL ELSE approved_by END,
              approved_at = CASE WHEN $5 = 'approved' THEN now() WHEN $5 = 'draft' THEN NULL ELSE approved_at END,
              sent_marked_at = CASE WHEN $5 = 'sent_manually' THEN now() ELSE sent_marked_at END
        WHERE id = $1 RETURNING to_email, subject, body, status::text`,
      [id, input.to ?? null, input.subject ?? null, input.body ?? null, status, viewer.id],
    );
    if (current.transaction_id) {
      await db.query("INSERT INTO audit_log (team_id, actor_id, action, entity_type, entity_id, data) VALUES ($1, $2, $3, 'transaction', $4, $5)", [
        viewer.teamId,
        viewer.id,
        `draft.${input.action}`,
        current.transaction_id,
        { draftId: id },
      ]);
    }
    return row!;
  });
  return Response.json({ status: result.status, mailto: result.status === "approved" ? mailtoLink(result.to_email, result.subject, result.body) : null });
});
