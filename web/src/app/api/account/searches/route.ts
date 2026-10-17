import { z } from "zod";
import { contextFor, requireCustomer, assertEmailVerified } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { assertUuid, handler, notFound, parseBody } from "@/lib/server/http";

const criteria = z.record(z.string().max(40), z.union([z.string().max(120), z.number(), z.boolean(), z.array(z.string().max(60)).max(20), z.null()])).refine((c) => Object.keys(c).length <= 20, "Too many criteria.");
const schema = z.object({ name: z.string().trim().min(1).max(80), criteria });

/** Saved searches (customer only, own rows via RLS). */
export const GET = handler(async (request: Request) => {
  const viewer = await requireCustomer(request);
  const searches = await withDb(contextFor(viewer), (db) => db.query(`SELECT id, name, criteria, created_at AS "createdAt" FROM saved_searches ORDER BY created_at DESC`));
  return Response.json({ searches });
});

export const POST = handler(async (request: Request) => {
  const viewer = await requireCustomer(request);
  assertEmailVerified(viewer);
  const input = await parseBody(request, schema);
  const row = await withDb(contextFor(viewer), (db) =>
    db.one<{ id: string }>(
      `INSERT INTO saved_searches (user_id, name, criteria) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, name) DO UPDATE SET criteria = EXCLUDED.criteria RETURNING id`,
      [viewer.id, input.name, input.criteria],
    ),
  );
  return Response.json({ id: row!.id }, { status: 201 });
});

export const DELETE = handler(async (request: Request) => {
  const viewer = await requireCustomer(request);
  const id = new URL(request.url).searchParams.get("id") ?? "";
  assertUuid(id, "Search");
  const rows = await withDb(contextFor(viewer), (db) => db.query("DELETE FROM saved_searches WHERE id = $1 RETURNING id", [id]));
  if (!rows.length) throw notFound("Search");
  return new Response(null, { status: 204 });
});
