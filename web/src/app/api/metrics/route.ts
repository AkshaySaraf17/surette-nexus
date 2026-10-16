import { connection } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { metrics } from "@/lib/server/metrics";

/**
 * GET /api/metrics — Prometheus exposition format.
 *
 * Protected by METRICS_TOKEN (Authorization: Bearer <token>) when set. In Kubernetes,
 * Prometheus scrapes pods directly on the cluster network and the gateway blocks
 * /api/metrics from the internet (see deploy/nginx and the Ingress), so the token is a
 * second layer. Without METRICS_TOKEN it's open — fine on a laptop, not in production.
 */
function authorized(request: Request): boolean {
  const token = process.env.METRICS_TOKEN;
  if (!token) return process.env.NODE_ENV !== "production";
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  await connection();
  if (!authorized(request)) return new Response("Forbidden", { status: 403 });
  return new Response(await metrics.registry.metrics(), { headers: { "Content-Type": metrics.registry.contentType, "Cache-Control": "no-store" } });
}
