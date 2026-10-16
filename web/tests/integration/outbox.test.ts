import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPool, withSystemDb } from "@/lib/server/db";
import { publishEvent } from "@/lib/server/events";
import { Worker } from "@/lib/server/worker/runtime";
import { siteTeamId, testTag } from "../helpers/db";

/** Event-driven core: events commit with their transaction, and the relay fans them out exactly once. */
const tag = testTag();
let teamId: string;

beforeAll(async () => {
  teamId = await siteTeamId();
  // Subscribe first: a running worker may relay events the instant they're published.
  await withSystemDb((db) =>
    db.query("INSERT INTO webhook_subscriptions (team_id, url, secret, events) VALUES ($1, $2, $3, ARRAY['lead.created'])", [teamId, `https://example.invalid/${tag}`, "s".repeat(32)]),
  );
});
afterAll(async () => {
  await withSystemDb(async (db) => {
    await db.query("DELETE FROM jobs WHERE payload->'data'->>'tag' = $1", [tag]);
    await db.query("DELETE FROM outbox_events WHERE payload->>'tag' = $1", [tag]);
    await db.query("DELETE FROM webhook_subscriptions WHERE url LIKE $1", [`%${tag}%`]);
  });
  await getPool().end();
});

describe("transactional outbox", () => {
  it("an event exists only if its transaction committed", async () => {
    await expect(
      withSystemDb(async (db) => {
        await publishEvent(db, { type: "lead.created", teamId, aggregate: "lead", payload: { tag, which: "rolled-back" } });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    await withSystemDb((db) => publishEvent(db, { type: "lead.created", teamId, aggregate: "lead", payload: { tag, which: "committed" } }));
    const rows = await withSystemDb((db) => db.query<{ which: string }>("SELECT payload->>'which' AS which FROM outbox_events WHERE payload->>'tag' = $1", [tag]));
    expect(rows.map((r) => r.which)).toEqual(["committed"]);
  });

  it("the relay fans events out into exactly one webhook job per matching subscription and marks them published", async () => {
    // Several relayers (this one + any running worker) must not duplicate work.
    await Promise.all([new Worker({ id: "test-relay-1", port: null }).relayOutbox(), new Worker({ id: "test-relay-2", port: null }).relayOutbox()]);
    // Another relayer may hold the row (SKIP LOCKED) for a moment: publication is eventual.
    let pending = 1;
    for (let i = 0; i < 30 && pending > 0; i++) {
      pending = (await withSystemDb((db) => db.one<{ n: number }>("SELECT count(*)::int AS n FROM outbox_events WHERE payload->>'tag' = $1 AND published_at IS NULL", [tag])))!.n;
      if (pending > 0) await new Promise((r) => setTimeout(r, 100));
    }
    expect(pending).toBe(0);
    const jobs = await withSystemDb((db) =>
      db.query<{ queue: string }>("SELECT queue FROM jobs WHERE type = 'webhook.deliver' AND payload->'data'->>'tag' = $1", [tag]),
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0].queue).toBe("webhooks");
  });
});
