import { z } from "zod";
import { contextFor, requireCustomer } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { assertUuid, handler, notFound, parseBody } from "@/lib/server/http";

const schema = z.object({ sharedWithAgent: z.boolean() });

/** PATCH — share/unshare with your assigned agent. DELETE — remove. Owner only (RLS). */
export const PATCH = handler(async (request: Request, { params }: RouteContext<"/api/dual-move/scenarios/[id]">) => {
  const { id } = await params;
  assertUuid(id, "Scenario");
  const viewer = await requireCustomer(request);
  const input = await parseBody(request, schema);
  const rows = await withDb(contextFor(viewer), (db) => db.query("UPDATE dual_move_scenarios SET shared_with_agent = $2 WHERE id = $1 RETURNING id", [id, input.sharedWithAgent]));
  if (!rows.length) throw notFound("Scenario");
  return Response.json({ ok: true });
});

export const DELETE = handler(async (request: Request, { params }: RouteContext<"/api/dual-move/scenarios/[id]">) => {
  const { id } = await params;
  assertUuid(id, "Scenario");
  const viewer = await requireCustomer(request);
  const rows = await withDb(contextFor(viewer), (db) => db.query("DELETE FROM dual_move_scenarios WHERE id = $1 RETURNING id", [id]));
  if (!rows.length) throw notFound("Scenario");
  return new Response(null, { status: 204 });
});
