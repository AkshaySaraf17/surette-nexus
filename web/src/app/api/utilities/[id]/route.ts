import { z } from "zod";
import { contextFor, requireStaff } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { assertUuid, handler, notFound, parseBody } from "@/lib/server/http";
import { getBill } from "@/lib/server/utilities";

const patchSchema = z.object({
  paidOn: z.iso.date("Use YYYY-MM-DD.").nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

/** PATCH /api/utilities/:id — mark paid / unpaid or edit notes. */
export const PATCH = handler(async (request: Request, { params }: RouteContext<"/api/utilities/[id]">) => {
  const { id } = await params;
  assertUuid(id, "Bill");
  const viewer = await requireStaff(request);
  const input = await parseBody(request, patchSchema);
  const context = contextFor(viewer);
  await withDb(context, async (db) => {
    const rows = await db.query(
      `UPDATE utility_ledgers
          SET paid_on = CASE WHEN $2 THEN $3::date ELSE paid_on END,
              notes = CASE WHEN $4 THEN $5 ELSE notes END
        WHERE id = $1 RETURNING id`,
      [id, input.paidOn !== undefined, input.paidOn ?? null, input.notes !== undefined, input.notes ?? null],
    );
    if (rows.length === 0) throw notFound("Bill");
  });
  return Response.json({ bill: await getBill(context, id) });
});

/** DELETE /api/utilities/:id */
export const DELETE = handler(async (request: Request, { params }: RouteContext<"/api/utilities/[id]">) => {
  const { id } = await params;
  assertUuid(id, "Bill");
  const viewer = await requireStaff(request);
  const rows = await withDb(contextFor(viewer), (db) => db.query("DELETE FROM utility_ledgers WHERE id = $1 RETURNING id", [id]));
  if (rows.length === 0) throw notFound("Bill");
  return new Response(null, { status: 204 });
});
