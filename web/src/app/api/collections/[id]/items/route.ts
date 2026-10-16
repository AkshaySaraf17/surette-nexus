import { after } from "next/server";
import { contextFor, requireViewer } from "@/lib/server/auth";
import { assertUuid, handler, parseBody } from "@/lib/server/http";
import { getCollection, removeItem, upsertItem } from "@/lib/server/collections";
import { emitWebhook } from "@/lib/server/webhooks";
import { collectionItemSchema } from "@/lib/validation";

/** POST /api/collections/:id/items — add a home, or update its reaction/note. */
export const POST = handler(async (request: Request, { params }: RouteContext<"/api/collections/[id]/items">) => {
  const { id } = await params;
  assertUuid(id, "Collection");
  const viewer = await requireViewer(request);
  const input = await parseBody(request, collectionItemSchema);
  const context = contextFor(viewer);
  await upsertItem(context, viewer, id, input);
  if (viewer.teamId) after(() => emitWebhook(viewer.teamId!, "collection.activity", { collectionId: id, propertyId: input.propertyId, by: viewer.role }));
  return Response.json({ collection: await getCollection(context, id) });
});

/** DELETE /api/collections/:id/items?propertyId= */
export const DELETE = handler(async (request: Request, { params }: RouteContext<"/api/collections/[id]/items">) => {
  const { id } = await params;
  assertUuid(id, "Collection");
  const propertyId = new URL(request.url).searchParams.get("propertyId") ?? "";
  assertUuid(propertyId, "Listing");
  const viewer = await requireViewer(request);
  const context = contextFor(viewer);
  await removeItem(context, id, propertyId);
  return Response.json({ collection: await getCollection(context, id) });
});
