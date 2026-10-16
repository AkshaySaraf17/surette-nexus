import { after } from "next/server";
import { contextFor, getViewer, requireStaff } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { ApiError, assertUuid, handler, notFound, parseBody } from "@/lib/server/http";
import { getListingById } from "@/lib/server/listings";
import { updateListing } from "@/lib/server/listing-writes";
import { keyPrefixFromStorageKey, removeRenditions } from "@/lib/server/media";
import { emitWebhook } from "@/lib/server/webhooks";
import { listingPatchSchema } from "@/lib/validation";

/** GET /api/properties/:id — public for published listings; staff also see their drafts. */
export const GET = handler(async (request: Request, { params }: RouteContext<"/api/properties/[id]">) => {
  const { id } = await params;
  assertUuid(id, "Listing");
  const viewer = await getViewer(request);
  const property = await getListingById(contextFor(viewer), id);
  if (!property) throw notFound("Listing");
  return Response.json({ property });
});

/** PATCH /api/properties/:id — edit listing fields (status changes publish/unpublish live). */
export const PATCH = handler(async (request: Request, { params }: RouteContext<"/api/properties/[id]">) => {
  const { id } = await params;
  assertUuid(id, "Listing");
  const viewer = await requireStaff(request);
  const patch = await parseBody(request, listingPatchSchema);
  const context = contextFor(viewer);
  const result = await withDb(context, (db) => updateListing(db, id, patch));
  const property = await getListingById(context, id);
  after(() =>
    emitWebhook(viewer.teamId, result.published ? "listing.published" : "listing.updated", { propertyId: id, slug: result.slug }),
  );
  return Response.json({ property });
});

/** DELETE /api/properties/:id — admins only (RLS); removes media files too. */
export const DELETE = handler(async (request: Request, { params }: RouteContext<"/api/properties/[id]">) => {
  const { id } = await params;
  assertUuid(id, "Listing");
  const viewer = await requireStaff(request);
  if (viewer.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Only admins can delete listings. Mark it off market instead.");
  const keys = await withDb(contextFor(viewer), async (db) => {
    const media = await db.query<{ storage_key: string }>("SELECT storage_key FROM media_assets WHERE property_id = $1", [id]);
    const deleted = await db.query("DELETE FROM properties WHERE id = $1 RETURNING id", [id]);
    if (deleted.length === 0) throw notFound("Listing");
    return media.map((m) => m.storage_key);
  });
  after(() => Promise.all(keys.map((k) => removeRenditions(keyPrefixFromStorageKey(k)))));
  return new Response(null, { status: 204 });
});
