import { expect, test } from "@playwright/test";
import WebSocket from "ws";

/** WebSocket live updates (realtime server on :3200 — start it with `npm run realtime`). */
const OWNER = { email: "owner@surette.test", password: "surette-owner-2026" };
const WS_URL = process.env.E2E_REALTIME_URL ?? "ws://localhost:3200/ws";

test("WebSocket clients get live changes; cross-site cookie connections are refused", async ({ request }) => {
  const messages: { type: string; table?: string }[] = [];
  const ws = new WebSocket(WS_URL, "surette.v1");
  await new Promise<void>((resolve, reject) => {
    ws.on("message", (m) => {
      const msg = JSON.parse(String(m));
      messages.push(msg);
      if (msg.type === "ready") resolve();
    });
    ws.on("error", reject);
  });
  expect(messages[0]).toMatchObject({ type: "ready", viewer: null });

  // The owner edits a listing; anonymous visitors hear about public listing changes.
  await request.post("/api/auth/login", { data: { ...OWNER, audience: "staff" }, headers: { Origin: "http://localhost:3100" } });
  const { listings } = await (await request.get("/api/properties?limit=1")).json();
  const id = listings[0].id;
  const detail = await (await request.get(`/api/properties/${id}`)).json();
  const patch = await request.patch(`/api/properties/${id}`, { data: { headline: detail.property?.headline ?? detail.headline }, headers: { Origin: "http://localhost:3100" } });
  expect(patch.status()).toBeLessThan(300);
  // Regression: a partial edit must not change anything else (it used to reset status to "draft").
  const after = await (await request.get(`/api/properties/${id}`)).json();
  expect((after.property ?? after).status).toBe((detail.property ?? detail).status);
  await expect.poll(() => messages.some((m) => m.type === "change" && m.table === "properties"), { timeout: 5_000 }).toBe(true);
  ws.close();

  const state = (await request.storageState()).cookies.find((c) => c.name === "sn_session");
  const status = await new Promise<number>((resolve) => {
    const evil = new WebSocket(WS_URL, "surette.v1", { headers: { Cookie: `sn_session=${state?.value}`, Origin: "https://evil.example" } });
    evil.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    evil.on("open", () => resolve(101));
    evil.on("error", () => undefined);
  });
  expect(status).toBe(403);
});
