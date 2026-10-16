import { handler } from "@/lib/server/http";
import { readiness } from "@/lib/server/health";

/** GET /api/health — readiness summary for people and uptime monitors. See lib/server/health.ts. */
export const GET = handler(async () => {
  const r = await readiness();
  return Response.json(r, { status: r.status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
});
