import { after } from "next/server";
import { contextFor, requireStaff } from "@/lib/server/auth";
import { assertUuid, handler, parseBody } from "@/lib/server/http";
import { updateShowing } from "@/lib/server/showings";
import { emitWebhook } from "@/lib/server/webhooks";
import { showingUpdateSchema } from "@/lib/validation";

/** PATCH /api/showings/:id — confirm, complete or cancel (staff). Overlapping confirmations return 409. */
export const PATCH = handler(async (request: Request, { params }: RouteContext<"/api/showings/[id]">) => {
  const { id } = await params;
  assertUuid(id, "Showing");
  const viewer = await requireStaff(request);
  const input = await parseBody(request, showingUpdateSchema);
  const showing = await updateShowing(contextFor(viewer), id, input.status, input.notes);
  after(() => emitWebhook(viewer.teamId, "showing.updated", { showingId: id, status: showing.status, propertyId: showing.propertyId }));
  return Response.json({ showing });
});
