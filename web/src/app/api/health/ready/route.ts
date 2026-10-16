import { handler } from "@/lib/server/http";
import { readiness } from "@/lib/server/health";

/** GET /api/health/ready — Kubernetes readiness probe. 503 takes the pod out of rotation. */
export const GET = handler(async () => {
  const r = await readiness();
  return Response.json(r, { status: r.status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
});
