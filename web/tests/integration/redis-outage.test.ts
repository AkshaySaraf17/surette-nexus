import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cached } from "@/lib/server/cache";
import { getPool } from "@/lib/server/db";
import { hit } from "@/lib/server/limiter";
import { closeRedis, redisHealthy } from "@/lib/server/redis";

/**
 * Resilience: when Redis/Valkey is configured but unreachable, the site keeps working —
 * rate limits fall back to per-instance memory and the cache loads from the database —
 * and nothing hangs (each Redis command is capped at ~1 s).
 */
beforeAll(() => {
  process.env.REDIS_URL = "redis://127.0.0.1:6390"; // nothing listens here
});
afterAll(async () => {
  await closeRedis();
  await getPool().end();
});

describe("Redis outage", () => {
  it("readiness reports Redis as down", async () => {
    expect(await redisHealthy()).toBe(false);
  });

  it("rate limiting fails open to memory, quickly", async () => {
    const started = Date.now();
    const r = await hit("outage", "1.1.1.1", 3, 60_000, "redis");
    expect(r.allowed).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("the cache falls back to loading from the source", async () => {
    const started = Date.now();
    expect(await cached("outage-key", { ttlMs: 1_000 }, async () => "from-db")).toBe("from-db");
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
