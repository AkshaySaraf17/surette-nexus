import { contextFor, requireStaff } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { ApiError, assertUuid, handler, parseBody } from "@/lib/server/http";
import { getBill, listBills } from "@/lib/server/utilities";
import { utilityBillSchema } from "@/lib/validation";

/** GET /api/utilities[?propertyId=] — bills and per-utility totals (staff of the owning team, via RLS). */
export const GET = handler(async (request: Request) => {
  const viewer = await requireStaff(request);
  const propertyId = new URL(request.url).searchParams.get("propertyId") ?? undefined;
  if (propertyId) assertUuid(propertyId, "Listing");
  return Response.json(await listBills(contextFor(viewer), propertyId));
});

/** POST /api/utilities — record a bill. `amountCents` must be a positive integer (e.g. $410.67 → 41067). */
export const POST = handler(async (request: Request) => {
  const viewer = await requireStaff(request);
  const input = await parseBody(request, utilityBillSchema);
  const id = crypto.randomUUID();
  const context = contextFor(viewer);
  await withDb(context, async (db) => {
    const visible = await db.one("SELECT 1 FROM properties WHERE id = $1 AND team_id = $2", [input.propertyId, viewer.teamId]);
    if (!visible) throw new ApiError(404, "NOT_FOUND", "Property not found.", { propertyId: "Pick one of your properties." });
    await db.query(
      `INSERT INTO utility_ledgers (id, property_id, utility, provider, account_last4, period_start, period_end,
                                    usage_quantity, usage_unit, amount_cents, due_on, paid_on, notes, recorded_by)
       VALUES ($1, $2, $3::utility_kind, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        id,
        input.propertyId,
        input.utility,
        input.provider,
        input.accountLast4 ?? null,
        input.periodStart,
        input.periodEnd,
        input.usageQuantity ?? null,
        input.usageUnit ?? null,
        input.amountCents,
        input.dueOn ?? null,
        input.paidOn ?? null,
        input.notes ?? null,
        viewer.id,
      ],
    );
  });
  return Response.json({ bill: await getBill(context, id) }, { status: 201 });
});
