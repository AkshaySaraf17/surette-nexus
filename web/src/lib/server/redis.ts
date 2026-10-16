import Redis from "ioredis";
import { childLogger } from "./logger";

/**
 * Optional Redis (REDIS_URL). Used, when configured, for the shared rate limiter, the
 * shared cache and cache-invalidation pub/sub. Everything works without it: the rate
 * limiter falls back to Postgres and the cache to in-process memory.
 */
const log = childLogger("redis");
const globalForRedis = globalThis as unknown as { suretteRedis?: Redis | null };

export function getRedis(): Redis | null {
  if (globalForRedis.suretteRedis !== undefined) return globalForRedis.suretteRedis;
  const url = process.env.REDIS_URL;
  if (!url) return (globalForRedis.suretteRedis = null);
  // Commands issued while connecting wait for the connection (offline queue), but each is capped
  // at 1 s and one retry, so a Redis outage still fails fast and callers fall back.
  const redis = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: true, commandTimeout: 1_000, connectTimeout: 2_000 });
  redis.on("error", (error) => log.warn({ err: error.message }, "redis error"));
  return (globalForRedis.suretteRedis = redis);
}

export async function redisHealthy(): Promise<boolean | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return (await redis.ping()) === "PONG";
  } catch {
    return false;
  }
}

/** Close the shared connection so command-line scripts can exit (an open socket keeps Node alive). */
export async function closeRedis(): Promise<void> {
  const redis = globalForRedis.suretteRedis;
  globalForRedis.suretteRedis = undefined;
  if (redis) await redis.quit().catch(() => redis.disconnect());
}
