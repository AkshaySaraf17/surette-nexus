import { z } from "zod";
import { contextFor, requireViewer, assertEmailVerified } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { handler, parseBody } from "@/lib/server/http";
import { ensureDefaultCollection, savedPropertyIds, upsertItem } from "@/lib/server/collections";

const schema = z.object({ propertyId: z.uuid(), saved: z.boolean() });

/** GET /api/collections/save — ids of homes the viewer has saved (for heart icons). */
export const GET = handler(async (request: Request) => {
  const viewer = await requireViewer(request);
  return Response.json({ propertyIds: await savedPropertyIds(contextFor(viewer), viewer) });
});

/** POST /api/collections/save — one-tap heart: save to / remove from every collection of the viewer. */
export const POST = handler(async (request: Request) => {
  const viewer = await requireViewer(request);
  assertEmailVerified(viewer);
  const input = await parseBody(request, schema);
  const context = contextFor(viewer);
  if (input.saved) {
    const collectionId = await ensureDefaultCollection(context, viewer);
    await upsertItem(context, viewer, collectionId, { propertyId: input.propertyId });
  } else {
    await withDb(context, (db) =>
      db.query(
        `DELETE FROM collection_items ci USING collections c
          WHERE ci.collection_id = c.id AND c.owner_id = $1 AND ci.property_id = $2`,
        [viewer.id, input.propertyId],
      ),
    );
  }
  return Response.json({ propertyIds: await savedPropertyIds(context, viewer) });
});
