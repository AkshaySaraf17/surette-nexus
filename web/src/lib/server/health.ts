import { readdirSync } from "node:fs";
import path from "node:path";
import { allBreakers } from "./circuit-breaker";
import { poolStats, withSystemDb } from "./db";
import { redisHealthy } from "./redis";

/**
 * Health model (used by Kubernetes probes and the load balancer):
 *
 *   /api/health/live   liveness  — the process can serve HTTP. Never checks dependencies,
 *                                  so a database blip doesn't make Kubernetes restart every pod.
 *   /api/health/ready  readiness — can this instance do useful work right now? Database
 *                                  reachable, migrations applied, pool not exhausted, Redis
 *                                  reachable if configured. Failing pods are taken out of
 *                                  the load balancer until they recover.
 *   /api/health        summary for humans and uptime checkers (same as ready).
 *
 * Open circuit breakers are reported but don't fail readiness: the site degrades
 * gracefully (built-in answers, cached market data) rather than going dark.
 *
 * Connection-pool pressure is reported but deliberately does NOT fail readiness: under a
 * traffic spike every pod is busy at once, and failing them all would pull the whole fleet
 * out of the load balancer (a self-inflicted outage). Saturation is alerted on instead
 * (SuretteDbPoolSaturated). Found by the load test (load/smoke.load.mjs).
 * The result is cached for 2 s so frequent probes never add meaningful load.
 */
let expectedMigrations: string[] | null = null;
function migrationFiles(): string[] {
  if (expectedMigrations) return expectedMigrations;
  const dir = process.env.MIGRATIONS_DIR ?? path.resolve(/*turbopackIgnore: true*/ process.cwd(), "../database/migrations");
  try {
    expectedMigrations = readdirSync(/*turbopackIgnore: true*/ dir).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    expectedMigrations = []; // directory not shipped (e.g. slim image): skip the check
  }
  return expectedMigrations;
}

let cachedReadiness: { at: number; value: Awaited<ReturnType<typeof computeReadiness>> } | null = null;

export async function readiness() {
  if (cachedReadiness && Date.now() - cachedReadiness.at < 2_000) return cachedReadiness.value;
  const value = await computeReadiness();
  cachedReadiness = { at: Date.now(), value };
  return value;
}

async function computeReadiness() {
  const started = performance.now();
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  try {
    const applied = await withSystemDb((db) => db.query<{ version: string }>("SELECT version FROM schema_migrations"));
    checks.database = { ok: true, detail: `${Math.round(performance.now() - started)} ms` };
    const have = new Set(applied.map((r) => r.version));
    const missing = migrationFiles().filter((f) => !have.has(f) && !have.has(f.replace(/\.sql$/, "")));
    checks.migrations = missing.length ? { ok: false, detail: `pending: ${missing.join(", ")}` } : { ok: true };
  } catch (error) {
    checks.database = { ok: false, detail: error instanceof Error ? error.message : "unreachable" };
  }
  const pool = poolStats();
  checks.pool = { ok: true, detail: `${pool.total}/${pool.max} open, ${pool.waiting} waiting` }; // informational only
  const redis = await redisHealthy();
  if (redis !== null) checks.redis = { ok: redis };
  const breakers = allBreakers();
  const ok = Object.values(checks).every((c) => c.ok);
  return { status: ok ? "ok" : "unavailable", checks, breakers, uptimeSeconds: Math.round(process.uptime()) };
}
