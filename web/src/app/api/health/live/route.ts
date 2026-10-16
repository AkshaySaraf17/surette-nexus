import { connection } from "next/server";

/** GET /api/health/live — Kubernetes liveness probe. Deliberately checks nothing external. */
export async function GET() {
  await connection();
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
