import { contextFor, requireViewer, assertEmailVerified } from "@/lib/server/auth";
import { handler, parseBody } from "@/lib/server/http";
import { createCollection, listCollections } from "@/lib/server/collections";
import { collectionCreateSchema } from "@/lib/validation";

/** GET /api/collections — clients: their collections; agents: collections shared with them. */
export const GET = handler(async (request: Request) => {
  const viewer = await requireViewer(request);
  return Response.json({ collections: await listCollections(contextFor(viewer)) });
});

/** POST /api/collections — create a named collection, shared with the client's assigned agent. */
export const POST = handler(async (request: Request) => {
  const viewer = await requireViewer(request);
  assertEmailVerified(viewer);
  const input = await parseBody(request, collectionCreateSchema);
  const collection = await createCollection(contextFor(viewer), viewer, input.name);
  return Response.json({ collection }, { status: 201 });
});
