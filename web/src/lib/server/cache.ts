import { childLogger } from "./logger";
import { metrics } from "./metrics";
import { getRedis } from "./redis";

/**
 * Read-through cache for hot public reads (published listings, team directory, market
 * series).
 *
 *   L1  in-process LRU with a short TTL — no network hop at all
 *   L2  Redis (when REDIS_URL is set) — shared by every app instance
 *
 * Entries carry tags. Writes don't need to know about the cache: the Postgres change
 * feed (`surette_events`) that drives live updates also calls `invalidateTags()` in every
 * instance, and Redis pub/sub spreads explicit invalidations. Only anonymous/public data
 * is cached — never anything that depends on who is signed in.
 */
const log = childLogger("cache");
const L1_MAX = 500;

interface Entry {
  value: unknown;
  expiresAt: number;
  tags: string[];
}

const globalForCache = globalThis as unknown as { suretteCache?: Map<string, Entry>; suretteCacheSub?: boolean };
const l1 = (globalForCache.suretteCache ??= new Map<string, Entry>());

function l1Get(key: string): unknown | undefined {
  const entry = l1.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    l1.delete(key);
    return undefined;
  }
  // LRU: re-insert to mark as most recently used.
  l1.delete(key);
  l1.set(key, entry);
  return entry.value;
}

function l1Set(key: string, value: unknown, ttlMs: number, tags: string[]) {
  l1.set(key, { value, expiresAt: Date.now() + ttlMs, tags });
  while (l1.size > L1_MAX) l1.delete(l1.keys().next().value!);
}

const inflight = new Map<string, Promise<unknown>>();

/**
 * Return the cached value for `key`, or compute it with `load()` and cache it.
 * Concurrent misses for the same key share one load (request coalescing, which stops a
 * cache stampede when a popular entry expires).
 */
export async function cached<T>(key: string, opts: { ttlMs: number; tags?: string[] }, load: () => Promise<T>): Promise<T> {
  const tags = opts.tags ?? [];
  const hit = l1Get(key);
  if (hit !== undefined) {
    metrics.cacheRequests.inc({ cache: "l1", result: "hit" });
    return hit as T;
  }
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(`cache:${key}`);
      if (raw !== null) {
        metrics.cacheRequests.inc({ cache: "l2", result: "hit" });
        const value = JSON.parse(raw) as T;
        l1Set(key, value, Math.min(opts.ttlMs, 5_000), tags);
        return value;
      }
      metrics.cacheRequests.inc({ cache: "l2", result: "miss" });
    } catch (error) {
      log.debug({ err: (error as Error).message }, "redis read failed; continuing without L2");
    }
  }
  metrics.cacheRequests.inc({ cache: "l1", result: "miss" });

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const promise = (async () => {
    const value = await load();
    l1Set(key, value, opts.ttlMs, tags);
    if (redis) {
      try {
        const multi = redis.multi().set(`cache:${key}`, JSON.stringify(value), "PX", opts.ttlMs);
        for (const tag of tags) multi.sadd(`cachetag:${tag}`, `cache:${key}`).pexpire(`cachetag:${tag}`, opts.ttlMs * 2);
        await multi.exec();
      } catch {
        // L2 is best-effort.
      }
    }
    return value;
  })().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** Drop every entry carrying any of `tags`, here and (via Redis) in other instances. */
export async function invalidateTags(tags: string[], { broadcast = true } = {}): Promise<void> {
  for (const [key, entry] of l1) if (entry.tags.some((t) => tags.includes(t))) l1.delete(key);
  const redis = getRedis();
  if (!redis) return;
  try {
    for (const tag of tags) {
      const keys = await redis.smembers(`cachetag:${tag}`);
      if (keys.length) await redis.del(...keys, `cachetag:${tag}`);
    }
    if (broadcast) await redis.publish("surette:cache-invalidate", JSON.stringify(tags));
  } catch {
    // best-effort
  }
}

/** Subscribe this instance to invalidations published by other instances. */
export function subscribeInvalidations() {
  const redis = getRedis();
  if (!redis || globalForCache.suretteCacheSub) return;
  globalForCache.suretteCacheSub = true;
  const sub = redis.duplicate();
  void sub.subscribe("surette:cache-invalidate");
  sub.on("message", (_channel, message) => {
    try {
      void invalidateTags(JSON.parse(message) as string[], { broadcast: false });
    } catch {
      // ignore malformed messages
    }
  });
}

export function cacheStats() {
  return { l1Entries: l1.size, l2: Boolean(getRedis()) };
}
