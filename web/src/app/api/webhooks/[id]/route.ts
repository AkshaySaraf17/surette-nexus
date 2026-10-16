import { contextFor, requireStaff } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { ApiError, assertUuid, handler, notFound } from "@/lib/server/http";

/** DELETE /api/webhooks/:id (admins). */
export const DELETE = handler(async (request: Request, { params }: RouteContext<"/api/webhooks/[id]">) => {
  const { id } = await params;
  assertUuid(id, "Webhook");
  const viewer = await requireStaff(request);
  if (viewer.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Only admins manage webhooks.");
  const rows = await withDb(contextFor(viewer), (db) => db.query("DELETE FROM webhook_subscriptions WHERE id = $1 RETURNING id", [id]));
  if (rows.length === 0) throw notFound("Webhook");
  return new Response(null, { status: 204 });
});
