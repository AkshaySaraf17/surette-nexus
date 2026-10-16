import { after } from "next/server";
import { contextFor, getViewer, isStaff, requireStaff } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { handler, parseBody } from "@/lib/server/http";
import { getListingById, listListings, type ListingFilters } from "@/lib/server/listings";
import { createListing } from "@/lib/server/listing-writes";
import { emitWebhook } from "@/lib/server/webhooks";
import { listingInputSchema } from "@/lib/validation";

function intParam(value: string | null): number | undefined {
  return value && /^\d+$/.test(value) ? Number(value) : undefined;
}

/**
 * GET /api/properties — published listings (public). Staff may add ?drafts=1 to include
 * their team's drafts. Filters: q, city, type, minPrice, maxPrice (cents), minBeds, sold=1, sort, limit.
 */
export const GET = handler(async (request: Request) => {
  const viewer = await getViewer(request);
  const url = new URL(request.url);
  const sort = url.searchParams.get("sort");
  const type = url.searchParams.get("type");
  const filters: ListingFilters = {
    q: url.searchParams.get("q") ?? undefined,
    city: url.searchParams.get("city") ?? undefined,
    type: type === "sale" || type === "rent" ? type : undefined,
    minPriceCents: intParam(url.searchParams.get("minPrice")),
    maxPriceCents: intParam(url.searchParams.get("maxPrice")),
    minBeds: intParam(url.searchParams.get("minBeds")),
    includeSold: url.searchParams.get("sold") === "1",
    sort: sort === "newest" || sort === "price_asc" || sort === "price_desc" ? sort : "featured",
    limit: intParam(url.searchParams.get("limit")),
  };
  const includeDrafts = isStaff(viewer) && url.searchParams.get("drafts") === "1";
  const listings = await listListings(contextFor(viewer), filters, { includeDrafts });
  // Public results may be micro-cached by the gateway/CDN for a few seconds (live updates
  // refetch anyway); signed-in results are private and never shared.
  const cacheControl = viewer ? "private, no-store" : "public, max-age=0, s-maxage=15, stale-while-revalidate=60";
  return Response.json({ listings }, { headers: { "Cache-Control": cacheControl, Vary: "Cookie, Authorization" } });
});

/** POST /api/properties — create a listing from JSON (photos can follow via /api/properties/upload). */
export const POST = handler(async (request: Request) => {
  const viewer = await requireStaff(request);
  const input = await parseBody(request, listingInputSchema);
  const context = contextFor(viewer);
  const created = await withDb(context, (db) => createListing(db, viewer, input));
  const property = await getListingById(context, created.id);
  if (created.published) after(() => emitWebhook(viewer.teamId, "listing.published", { propertyId: created.id, slug: created.slug }));
  return Response.json({ property }, { status: 201 });
});
