import { z } from "zod";
import { contextFor, requireCustomer, assertEmailVerified } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { assertUuid, handler, notFound, parseBody } from "@/lib/server/http";

const schema = z.object({ name: z.string().trim().min(1).max(80).default("Comparison"), propertyIds: z.array(z.uuid()).min(2).max(4) });

export const GET = handler(async (request: Request) => {
  const viewer = await requireCustomer(request);
  const comparisons = await withDb(contextFor(viewer), (db) => db.query(`SELECT id, name, property_ids AS "propertyIds", created_at AS "createdAt" FROM property_comparisons ORDER BY created_at DESC LIMIT 20`));
  return Response.json({ comparisons });
});

export const POST = handler(async (request: Request) => {
  const viewer = await requireCustomer(request);
  assertEmailVerified(viewer);
  const input = await parseBody(request, schema);
  const row = await withDb(contextFor(viewer), (db) => db.one<{ id: string }>("INSERT INTO property_comparisons (user_id, name, property_ids) VALUES ($1, $2, $3) RETURNING id", [viewer.id, input.name, input.propertyIds]));
  return Response.json({ id: row!.id }, { status: 201 });
});

export const DELETE = handler(async (request: Request) => {
  const viewer = await requireCustomer(request);
  const id = new URL(request.url).searchParams.get("id") ?? "";
  assertUuid(id, "Comparison");
  const rows = await withDb(contextFor(viewer), (db) => db.query("DELETE FROM property_comparisons WHERE id = $1 RETURNING id", [id]));
  if (!rows.length) throw notFound("Comparison");
  return new Response(null, { status: 204 });
});
