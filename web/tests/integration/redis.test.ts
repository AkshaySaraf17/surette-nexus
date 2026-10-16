import { afterAll, describe, expect, it } from "vitest";
import { cached, invalidateTags } from "@/lib/server/cache";
import { getPool } from "@/lib/server/db";
import { hit } from "@/lib/server/limiter";
import { closeRedis, getRedis, redisHealthy } from "@/lib/server/redis";
import { testTag } from "../helpers/db";

/**
 * The Redis / Valkey code paths (shared rate limits, shared cache, tag invalidation).
 * Runs only when REDIS_URL is set, e.g.:  REDIS_URL=redis://localhost:6379 npm run test:integration
 * (brew services start valkey). Without it, the app uses Postgres limits and an in-process cache.
 */
const run = process.env.REDIS_URL ? describe : describe.skip;
const tag = testTag("r");

afterAll(async () => {
  const redis = getRedis();
  if (redis) {
    const keys = await redis.keys(`*${tag}*`);
    if (keys.length) await redis.del(...keys);
  }
  await closeRedis();
  await getPool().end();
});

run("Redis / Valkey backend", () => {
  it("is reachable", async () => {
    expect(await redisHealthy()).toBe(true);
  });

  it("shared rate limits count across callers and expire with the window", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await hit(`${tag}-b`, "9.9.9.9", 3, 2_000, "redis"));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    const keys = await getRedis()!.keys(`rl:${tag}-b:*`);
    expect(keys.length).toBe(1);
    expect(await getRedis()!.pttl(keys[0])).toBeGreaterThan(0);
  });

  it("the shared cache serves other instances and is cleared by tag", async () => {
    let loads = 0;
    const load = async () => ({ n: ++loads });
    expect(await cached(`${tag}-k`, { ttlMs: 60_000, tags: [`${tag}-t`] }, load)).toEqual({ n: 1 });
    // The value is now in Redis (L2) for every instance.
    expect(JSON.parse((await getRedis()!.get(`cache:${tag}-k`))!)).toEqual({ n: 1 });
    await invalidateTags([`${tag}-t`]);
    expect(await getRedis()!.get(`cache:${tag}-k`)).toBeNull();
    expect(await cached(`${tag}-k`, { ttlMs: 60_000, tags: [`${tag}-t`] }, load)).toEqual({ n: 2 });
  });
});
