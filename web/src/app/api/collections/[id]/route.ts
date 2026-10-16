import { contextFor, requireViewer } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { assertUuid, handler, notFound } from "@/lib/server/http";
import { getCollection } from "@/lib/server/collections";

export const GET = handler(async (request: Request, { params }: RouteContext<"/api/collections/[id]">) => {
  const { id } = await params;
  assertUuid(id, "Collection");
  const viewer = await requireViewer(request);
  return Response.json({ collection: await getCollection(contextFor(viewer), id) });
});

/** DELETE /api/collections/:id — owners only (RLS). */
export const DELETE = handler(async (request: Request, { params }: RouteContext<"/api/collections/[id]">) => {
  const { id } = await params;
  assertUuid(id, "Collection");
  const viewer = await requireViewer(request);
  const deleted = await withDb(contextFor(viewer), (db) => db.query("DELETE FROM collections WHERE id = $1 RETURNING id", [id]));
  if (deleted.length === 0) throw notFound("Collection");
  return new Response(null, { status: 204 });
});
