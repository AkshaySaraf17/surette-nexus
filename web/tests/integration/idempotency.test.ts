import { afterAll, describe, expect, it } from "vitest";
import { getPool, withSystemDb } from "@/lib/server/db";
import { idempotentJson } from "@/lib/server/idempotency";
import { runWithContext } from "@/lib/server/request-context";
import { testTag } from "../helpers/db";

const tag = testTag();
afterAll(async () => {
  await withSystemDb((db) => db.query("DELETE FROM idempotency_keys WHERE key LIKE $1", [`${tag}%`]));
  await getPool().end();
});

describe("idempotency keys", () => {
  const req = (key: string, body: string) =>
    new Request("http://localhost/api/test", { method: "POST", headers: { "Idempotency-Key": key, "content-type": "application/json" }, body });

  it("runs once and replays the stored response for a repeat", async () => {
    let runs = 0;
    const run = async () => Response.json({ n: ++runs }, { status: 201 });
    const key = `${tag}-a`;
    const first = await runWithContext({ requestId: "r1" }, () => idempotentJson(req(key, '{"x":1}'), "user-1", run));
    const second = await runWithContext({ requestId: "r2" }, () => idempotentJson(req(key, '{"x":1}'), "user-1", run));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual({ n: 1 });
    expect(second.headers.get("Idempotent-Replayed")).toBe("true");
    expect(runs).toBe(1);
  });

  it("rejects the same key with a different body, and scopes keys per user", async () => {
    const key = `${tag}-b`;
    await idempotentJson(req(key, '{"x":1}'), "user-1", async () => Response.json({ ok: true }));
    await expect(idempotentJson(req(key, '{"x":2}'), "user-1", async () => Response.json({ ok: true }))).rejects.toMatchObject({ status: 422 });
    const other = await idempotentJson(req(key, '{"x":2}'), "user-2", async () => Response.json({ other: true }));
    expect(await other.json()).toEqual({ other: true });
  });

  it("answers 409 while the original is still running, and frees the key if it fails", async () => {
    const key = `${tag}-c`;
    let release!: () => void;
    const slow = idempotentJson(req(key, "{}"), "user-1", () => new Promise<Response>((r) => (release = () => r(Response.json({ done: true })))));
    await new Promise((r) => setTimeout(r, 50));
    await expect(idempotentJson(req(key, "{}"), "user-1", async () => Response.json({}))).rejects.toMatchObject({ status: 409 });
    release();
    await slow;
    const failing = `${tag}-d`;
    await expect(idempotentJson(req(failing, "{}"), "user-1", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    const retry = await idempotentJson(req(failing, "{}"), "user-1", async () => Response.json({ retried: true }));
    expect(await retry.json()).toEqual({ retried: true });
  });
});
