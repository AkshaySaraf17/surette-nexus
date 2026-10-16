import { withSystemDb } from "./db";
import { metrics } from "./metrics";
import { getRedis } from "./redis";

/**
 * Fixed-window rate limiter with three interchangeable stores:
 *
 *   redis     INCR + PEXPIRE per window (when REDIS_URL is set) — shared, fastest
 *   postgres  upsert into the UNLOGGED rate_limit_counters table — shared, no extra service
 *   memory    per process — development and tests only
 *
 * RATE_LIMIT_STORE picks one explicitly; by default: redis if configured, otherwise
 * postgres in production and memory in development. If the shared store is unreachable
 * the limiter "fails open" to memory (a limiter outage must not take the site down).
 * The gateway (nginx limit_req) adds a coarse per-IP limit in front of all of this.
 */
export interface LimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number; // epoch ms
}

type Store = "redis" | "postgres" | "memory";

function chosenStore(): Store {
  const explicit = process.env.RATE_LIMIT_STORE as Store | undefined;
  if (explicit === "redis" || explicit === "postgres" || explicit === "memory") return explicit;
  if (process.env.REDIS_URL) return "redis";
  return process.env.NODE_ENV === "production" ? "postgres" : "memory";
}

const memory = new Map<string, { count: number; resetAt: number }>();
function memoryHit(key: string, windowMs: number, now: number): { count: number; resetAt: number } {
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + windowMs };
    memory.set(key, fresh);
    if (memory.size > 10_000) for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
    return fresh;
  }
  entry.count += 1;
  return entry;
}

async function redisHit(key: string, windowMs: number, windowStart: number) {
  const redis = getRedis();
  if (!redis) throw new Error("REDIS_URL not set");
  const k = `rl:${key}:${windowStart}`;
  const [[, count]] = (await redis.multi().incr(k).pexpire(k, windowMs + 1_000).exec()) as [[Error | null, number], unknown];
  return { count, resetAt: windowStart + windowMs };
}

async function postgresHit(key: string, windowMs: number, windowStart: number) {
  const row = await withSystemDb((db) =>
    db.one<{ count: number }>(
      `INSERT INTO rate_limit_counters (key, window_start, count) VALUES ($1, to_timestamp($2 / 1000.0), 1)
       ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_counters.count + 1
       RETURNING count`,
      [key, windowStart],
    ),
  );
  return { count: row!.count, resetAt: windowStart + windowMs };
}

export async function hit(bucket: string, subject: string, limit: number, windowMs: number, store: Store = chosenStore()): Promise<LimitResult> {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const key = `${bucket}:${subject}`;
  let result: { count: number; resetAt: number };
  try {
    result = store === "redis" ? await redisHit(key, windowMs, windowStart) : store === "postgres" ? await postgresHit(key, windowMs, windowStart) : memoryHit(key, windowMs, now);
  } catch {
    result = memoryHit(key, windowMs, now); // fail open to per-process limits
  }
  const allowed = result.count <= limit;
  if (!allowed) metrics.rateLimited.inc({ bucket });
  return { allowed, limit, remaining: Math.max(0, limit - result.count), resetAt: result.resetAt };
}

/**
 * Client address for per-IP limits. Our gateway overwrites X-Real-IP with the address it
 * actually saw, so that's trusted first. Otherwise use the LAST X-Forwarded-For entry (added
 * by the nearest proxy) — the first entries are whatever the client chose to send, so
 * trusting them would let anyone dodge rate limits by inventing addresses.
 */
export function clientIp(request: Request): string {
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const hops = request.headers.get("x-forwarded-for")?.split(",").map((h) => h.trim()).filter(Boolean);
  return hops?.at(-1) || "local";
}

/** Remove expired Postgres counters (run by the worker). */
export async function purgeRateLimitCounters(): Promise<number> {
  return withSystemDb(async (db) => (await db.query("DELETE FROM rate_limit_counters WHERE window_start < now() - interval '2 hours' RETURNING 1")).length);
}
