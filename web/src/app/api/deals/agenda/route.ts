import { contextFor, requireStaff } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { handler } from "@/lib/server/http";
import { urgency } from "@/lib/deal-rules";

/** GET /api/deals/agenda — open milestones and tasks across accessible deals (in-app reminders). */
export const GET = handler(async (request: Request) => {
  const viewer = await requireStaff(request);
  const mine = new URL(request.url).searchParams.get("mine") === "1";
  const rows = await withDb(contextFor(viewer), (db) =>
    db.query<{ kind: string; id: string; title: string; due_on: string | null; transaction_id: string; deal_title: string; assignee_id: string | null }>(
      `SELECT 'milestone' AS kind, m.id, m.label AS title, m.due_on, m.transaction_id, t.title AS deal_title, t.agent_id AS assignee_id
         FROM transaction_milestones m JOIN transactions t ON t.id = m.transaction_id
        WHERE m.completed_at IS NULL AND t.stage NOT IN ('closed', 'lost')
       UNION ALL
       SELECT 'task', k.id, k.title, k.due_on, k.transaction_id, t.title, k.assignee_id
         FROM transaction_tasks k JOIN transactions t ON t.id = k.transaction_id
        WHERE k.status = 'open' AND t.stage NOT IN ('closed', 'lost')
       ORDER BY due_on NULLS LAST LIMIT 300`,
    ),
  );
  const today = new Date().toISOString().slice(0, 10);
  const items = rows
    .filter((r) => !mine || r.assignee_id === viewer.id)
    .map((r) => ({ kind: r.kind, id: r.id, title: r.title, dueOn: r.due_on, dealId: r.transaction_id, dealTitle: r.deal_title, urgency: urgency(r.due_on, false, today) }));
  return Response.json({
    items,
    counts: { overdue: items.filter((i) => i.urgency === "overdue").length, dueSoon: items.filter((i) => i.urgency === "due_soon").length },
  });
});
