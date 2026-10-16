import { ANONYMOUS, withDb } from "@/lib/server/db";
import { ApiError, assertUuid, handler } from "@/lib/server/http";
import { suggestSlots } from "@/lib/server/showings";

/** GET /api/showings/slots?propertyId= — the next open showing times for an active listing. */
export const GET = handler(async (request: Request) => {
  const propertyId = new URL(request.url).searchParams.get("propertyId") ?? "";
  assertUuid(propertyId, "Listing");
  const property = await withDb(ANONYMOUS, (db) => db.one<{ status: string }>("SELECT status FROM properties WHERE id = $1", [propertyId]));
  if (!property || property.status !== "active") throw new ApiError(404, "NOT_FOUND", "This home isn't open for showings.");
  return Response.json({ slots: await suggestSlots(propertyId, 6) });
});
