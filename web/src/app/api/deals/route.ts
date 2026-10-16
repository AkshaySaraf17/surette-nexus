import { contextFor, requireStaff } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { createTransaction, DEAL_SELECT, toDealSummary, type DealSummaryRow } from "@/lib/server/deals";
import { idempotentJson } from "@/lib/server/idempotency";
import { handler, validate } from "@/lib/server/http";
import { DEAL_STAGES } from "@/lib/deal-rules";
import { dealCreateSchema } from "@/lib/validation";


/** GET /api/deals?stage=&q= — deals the caller may see (admins: team; agents: their own). */
export const GET = handler(async (request: Request) => {
  const viewer = await requireStaff(request);
  const url = new URL(request.url);
  const stage = url.searchParams.get("stage");
  const q = url.searchParams.get("q")?.trim();
  const where: string[] = [];
  const values: unknown[] = [];
  if (stage && (DEAL_STAGES as readonly string[]).includes(stage)) {
    values.push(stage);
    where.push(`t.stage = $${values.length}::deal_stage`);
  }
  if (q) {
    values.push(`%${q}%`);
    where.push(`(t.title ILIKE $${values.length} OR t.client_name ILIKE $${values.length} OR p.title ILIKE $${values.length})`);
  }
  const rows = await withDb(contextFor(viewer), (db) =>
    db.query<DealSummaryRow>(`${DEAL_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY t.updated_at DESC LIMIT 300`, values),
  );
  return Response.json({ deals: rows.map(toDealSummary) });
});

export const POST = handler(async (request: Request) => {
  const viewer = await requireStaff(request);
  return idempotentJson(request, viewer.id, async (raw) => {
    const input = validate(dealCreateSchema, raw);
    const deal = await createTransaction(viewer, input);
    return Response.json({ id: deal.id }, { status: 201 });
  });
});
