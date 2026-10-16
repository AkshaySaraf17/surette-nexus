import { expect, test } from "@playwright/test";
import { BASE, signIn } from "../helpers";

/** Authorization boundaries and request-forgery defences, checked over HTTP. */
test("cookie-authenticated writes from another website are blocked (CSRF)", async ({ request }) => {
  await signIn(request, "agent");
  const res = await request.post("/api/deals", { data: { title: "x", side: "buyer", clientName: "x" }, headers: { Origin: "https://evil.example" } });
  expect(res.status()).toBe(403);
  expect((await res.json()).error.code).toBe("BAD_ORIGIN");
});

test("anonymous visitors can't reach staff or admin APIs", async ({ request }) => {
  for (const path of ["/api/leads", "/api/deals", "/api/admin/users", "/api/analytics/overview?project=nexus-site", "/api/account"]) {
    expect([401, 403], path).toContain((await request.get(path)).status());
  }
});

test("customers can't use staff APIs; agents can't use owner APIs", async ({ playwright }) => {
  const client = await playwright.request.newContext({ baseURL: BASE });
  await signIn(client, "client");
  for (const path of ["/api/leads", "/api/deals", "/api/admin/users"]) expect((await client.get(path)).status(), path).toBe(403);
  const agent = await playwright.request.newContext({ baseURL: BASE });
  await signIn(agent, "agent");
  for (const path of ["/api/admin/users", "/api/admin/audit", "/api/analytics/overview?project=nexus-site"]) expect((await agent.get(path)).status(), path).toBe(403);
  await client.dispose();
  await agent.dispose();
});

test("an agent can't open another agent's deal", async ({ playwright }) => {
  const owner = await playwright.request.newContext({ baseURL: BASE });
  await signIn(owner, "owner");
  const ownerDeals = (await (await owner.get("/api/deals")).json()).deals as { id: string; agentName?: string; agent?: { email?: string } }[];
  const agent = await playwright.request.newContext({ baseURL: BASE });
  await signIn(agent, "agent");
  const mine = new Set(((await (await agent.get("/api/deals")).json()).deals as { id: string }[]).map((d) => d.id));
  const notMine = ownerDeals.find((d) => !mine.has(d.id));
  expect(notMine).toBeTruthy();
  expect((await agent.get(`/api/deals/${notMine!.id}`)).status()).toBe(404);
  await owner.dispose();
  await agent.dispose();
});

test("responses carry security headers", async ({ request }) => {
  const res = await request.get("/");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  expect(res.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
});
