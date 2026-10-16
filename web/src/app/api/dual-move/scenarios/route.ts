import { z } from "zod";
import { analyze, dualMoveInputSchema } from "@/lib/dual-move";
import { contextFor, requireCustomer } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { handler, parseBody } from "@/lib/server/http";

/** Saved Dual-Move scenarios — customers only, visible only to their owner (RLS). */
export const GET = handler(async (request: Request) => {
  const viewer = await requireCustomer(request);
  const scenarios = await withDb(contextFor(viewer), (db) =>
    db.query(`SELECT id, name, inputs, shared_with_agent AS "sharedWithAgent", updated_at AS "updatedAt" FROM dual_move_scenarios ORDER BY updated_at DESC LIMIT 50`),
  );
  return Response.json({ scenarios });
});

const schema = z.object({ name: z.string().trim().min(1, "Name the scenario.").max(80), inputs: dualMoveInputSchema });

export const POST = handler(async (request: Request) => {
  const viewer = await requireCustomer(request);
  const input = await parseBody(request, schema);
  const result = analyze(input.inputs);
  const row = await withDb(contextFor(viewer), (db) =>
    db.one<{ id: string }>("INSERT INTO dual_move_scenarios (user_id, name, inputs, results) VALUES ($1, $2, $3, $4) RETURNING id", [
      viewer.id,
      input.name,
      input.inputs,
      { expected: result.expected, gaps: result.gaps },
    ]),
  );
  return Response.json({ id: row!.id }, { status: 201 });
});
