import { after } from "next/server";
import { contextFor, requireViewer } from "@/lib/server/auth";
import { assertUuid, handler, parseBody } from "@/lib/server/http";
import { addComment, getCollection } from "@/lib/server/collections";
import { emitWebhook } from "@/lib/server/webhooks";
import { collectionCommentSchema } from "@/lib/validation";

/** POST /api/collections/:id/comments — client ↔ agent conversation on a collection (or one home in it). */
export const POST = handler(async (request: Request, { params }: RouteContext<"/api/collections/[id]/comments">) => {
  const { id } = await params;
  assertUuid(id, "Collection");
  const viewer = await requireViewer(request);
  const input = await parseBody(request, collectionCommentSchema);
  const context = contextFor(viewer);
  await addComment(context, viewer, id, input);
  if (viewer.teamId) after(() => emitWebhook(viewer.teamId!, "collection.activity", { collectionId: id, comment: true, by: viewer.role }));
  return Response.json({ collection: await getCollection(context, id) }, { status: 201 });
});
