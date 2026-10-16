import { contextFor, requireStaff } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { handler } from "@/lib/server/http";

/** GET /api/drafts — drafts awaiting approval or sending, across deals the caller can access. */
export const GET = handler(async (request: Request) => {
  const viewer = await requireStaff(request);
  const drafts = await withDb(contextFor(viewer), (db) =>
    db.query(
      `SELECT d.id, d.transaction_id AS "transactionId", t.title AS "dealTitle", d.to_email AS "to", d.subject, d.body, d.status::text AS status,
              d.ai_generated AS "aiGenerated", d.created_at AS "createdAt", d.approved_at AS "approvedAt"
         FROM communication_drafts d LEFT JOIN transactions t ON t.id = d.transaction_id
        WHERE d.status IN ('draft', 'approved') ORDER BY d.created_at DESC LIMIT 100`,
    ),
  );
  return Response.json({ drafts });
});
