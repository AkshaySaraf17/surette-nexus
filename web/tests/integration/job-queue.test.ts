import { afterAll, describe, expect, it } from "vitest";
import { getPool, withSystemDb } from "@/lib/server/db";
import { claimJobs, completeJob, enqueue, failJob } from "@/lib/server/jobs";
import { testTag } from "../helpers/db";

const tag = testTag();
afterAll(async () => {
  await withSystemDb((db) => db.query("DELETE FROM jobs WHERE payload->>'tag' = $1 OR dedupe_key LIKE $2", [tag, `${tag}%`]));
  await getPool().end();
});

describe("job queue", () => {
  it("never hands the same job to two workers (SKIP LOCKED)", async () => {
    await withSystemDb(async (db) => {
      for (let i = 0; i < 6; i++) await enqueue(db, "test.noop", { tag, i }, { queue: `q-${tag}` });
    });
    const [a, b] = await Promise.all([claimJobs("w-a", [`q-${tag}`], 4), claimJobs("w-b", [`q-${tag}`], 4)]);
    const ids = [...a, ...b].map((j) => j.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    for (const j of [...a, ...b]) await completeJob(j.id);
  });

  it("retries with backoff and dead-letters after max attempts", async () => {
    await withSystemDb((db) => enqueue(db, "test.flaky", { tag }, { queue: `r-${tag}`, maxAttempts: 2 }));
    const [first] = await claimJobs("w", [`r-${tag}`], 1);
    await failJob(first, new Error("nope"));
    const queued = await withSystemDb((db) => db.one<{ status: string; future: boolean }>("SELECT status::text, run_at > now() AS future FROM jobs WHERE id = $1", [first.id]));
    expect(queued).toEqual({ status: "queued", future: true });
    await withSystemDb((db) => db.query("UPDATE jobs SET run_at = now() WHERE id = $1", [first.id]));
    const [second] = await claimJobs("w", [`r-${tag}`], 1);
    expect(second.attempts).toBe(2);
    await failJob(second, new Error("still no"));
    const dead = await withSystemDb((db) => db.one<{ status: string; last_error: string }>("SELECT status::text, last_error FROM jobs WHERE id = $1", [first.id]));
    expect(dead).toEqual({ status: "dead", last_error: "still no" });
  });

  it("dedupe keys keep one queued job per key", async () => {
    const results = await withSystemDb(async (db) => [
      await enqueue(db, "test.dedupe", { tag }, { dedupeKey: `${tag}-once` }),
      await enqueue(db, "test.dedupe", { tag }, { dedupeKey: `${tag}-once` }),
    ]);
    expect(results).toEqual([true, false]);
  });
});
