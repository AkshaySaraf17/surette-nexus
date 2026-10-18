import { expect, test } from "@playwright/test";
import { closeDb, db, ownClientIp } from "../helpers";

/** Retries never duplicate (Idempotency-Key) and abuse is throttled (429 + Retry-After). */
const RUN = Date.now().toString(36);

test.afterAll(async () => {
  await db().query("DELETE FROM leads WHERE contact_name LIKE 'E2E %'");
  await closeDb();
});

test("a repeated Idempotency-Key replays the first response instead of creating a duplicate", async ({ request }) => {
  // A fresh address each run: the contact form allows 6 leads per hour per address.
  const headers = { "Idempotency-Key": `e2e-${RUN}-lead`, ...ownClientIp(1), Origin: "http://localhost:3100" };
  const data = { source: "contact_form", contactName: `E2E ${RUN} idem`, contactEmail: `e2e+${RUN}@example.com`, message: "Idempotency test", consentContact: true };
  const first = await request.post("/api/leads", { data, headers });
  const second = await request.post("/api/leads", { data, headers });
  expect(first.status()).toBe(201);
  expect(second.status()).toBe(201);
  expect(second.headers()["idempotent-replayed"]).toBe("true");
  expect((await second.json()).lead.id).toBe((await first.json()).lead.id);
  const reused = await request.post("/api/leads", { data: { ...data, message: "different" }, headers });
  expect(reused.status()).toBe(422);
  const { rows } = await db().query("SELECT count(*)::int AS n FROM leads WHERE contact_name = $1", [`E2E ${RUN} idem`]);
  expect(rows[0].n).toBe(1);
});

test("rate limits answer 429 with Retry-After", async ({ request }) => {
  const headers = { "X-Real-IP": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, Origin: "http://localhost:3100" };
  let last = 0;
  let retryAfter: string | undefined;
  for (let i = 0; i < 7; i++) {
    const res = await request.post("/api/leads", { data: {}, headers });
    last = res.status();
    retryAfter = res.headers()["retry-after"];
  }
  expect(last).toBe(429);
  expect(Number(retryAfter)).toBeGreaterThan(0);
});
