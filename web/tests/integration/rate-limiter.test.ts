import { afterAll, describe, expect, it } from "vitest";
import { getPool, withSystemDb } from "@/lib/server/db";
import { hit } from "@/lib/server/limiter";
import { testTag } from "../helpers/db";

const tag = testTag();
afterAll(async () => {
  await withSystemDb((db) => db.query("DELETE FROM rate_limit_counters WHERE key LIKE $1", [`${tag}%`]));
  await getPool().end();
});

describe("shared rate limiter (Postgres store)", () => {
  it("allows up to the limit per window and then refuses, per subject", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await hit(`${tag}-bucket`, "1.2.3.4", 3, 60_000, "postgres"));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3].remaining).toBe(0);
    expect((await hit(`${tag}-bucket`, "5.6.7.8", 3, 60_000, "postgres")).allowed).toBe(true);
  });
});
