import { contextFor, requireCustomer } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { handler } from "@/lib/server/http";
import { STAGE_LABEL } from "@/lib/deal-rules";

/** GET /api/account/deals — the customer's own transactions: stage + client-visible milestones only. */
export const GET = handler(async (request: Request) => {
  const viewer = await requireCustomer(request);
  const deals = await withDb(contextFor(viewer), async (db) => {
    const rows = await db.query<{ id: string; title: string; stage: keyof typeof STAGE_LABEL; closing_date: string | null; agent: string | null }>(
      "SELECT t.id, t.title, t.stage, t.closing_date, u.full_name AS agent FROM transactions t LEFT JOIN users u ON u.id = t.agent_id WHERE t.client_user_id = $1 ORDER BY t.updated_at DESC",
      [viewer.id],
    );
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        title: r.title,
        stage: r.stage,
        stageLabel: STAGE_LABEL[r.stage],
        closingDate: r.closing_date,
        agent: r.agent,
        milestones: await db.query(`SELECT label, due_on AS "dueOn", completed_at IS NOT NULL AS done FROM transaction_milestones WHERE transaction_id = $1 ORDER BY due_on NULLS LAST, sort_order`, [r.id]),
      })),
    );
  });
  return Response.json({ deals });
});
