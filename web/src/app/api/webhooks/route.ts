import { randomBytes } from "node:crypto";
import { contextFor, requireStaff } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { ApiError, handler, parseBody } from "@/lib/server/http";
import { webhookSchema } from "@/lib/validation";

async function requireAdmin(request: Request) {
  const viewer = await requireStaff(request);
  if (viewer.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Only admins manage webhooks.");
  return viewer;
}

/** GET /api/webhooks — subscriptions with their latest delivery result (admins). */
export const GET = handler(async (request: Request) => {
  const viewer = await requireAdmin(request);
  const subscriptions = await withDb(contextFor(viewer), (db) =>
    db.query<{ id: string; url: string; events: string[]; is_active: boolean; created_at: Date; last_status: number | null; last_error: string | null; last_at: Date | null }>(
      `SELECT s.id, s.url, s.events, s.is_active, s.created_at,
              d.status_code AS last_status, d.error AS last_error, d.created_at AS last_at
         FROM webhook_subscriptions s
         LEFT JOIN LATERAL (
           SELECT status_code, error, created_at FROM webhook_deliveries
            WHERE subscription_id = s.id ORDER BY created_at DESC LIMIT 1
         ) d ON true
        ORDER BY s.created_at DESC`,
    ),
  );
  return Response.json({
    webhooks: subscriptions.map((s) => ({
      id: s.id,
      url: s.url,
      events: s.events,
      isActive: s.is_active,
      createdAt: s.created_at.toISOString(),
      lastDelivery: s.last_at ? { statusCode: s.last_status, error: s.last_error, at: s.last_at.toISOString() } : null,
    })),
  });
});

/** POST /api/webhooks — register an endpoint. The signing secret is returned ONCE. */
export const POST = handler(async (request: Request) => {
  const viewer = await requireAdmin(request);
  const input = await parseBody(request, webhookSchema);
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  const id = crypto.randomUUID();
  await withDb(contextFor(viewer), (db) =>
    db.query("INSERT INTO webhook_subscriptions (id, team_id, url, secret, events) VALUES ($1, $2, $3, $4, $5)", [
      id,
      viewer.teamId,
      input.url,
      secret,
      input.events,
    ]),
  );
  return Response.json({ webhook: { id, url: input.url, events: input.events, secret } }, { status: 201 });
});
