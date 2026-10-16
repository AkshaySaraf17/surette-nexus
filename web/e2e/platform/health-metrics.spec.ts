import { expect, test } from "@playwright/test";

/** Health checks, Prometheus metrics, request ids and cache headers. */
const RUN = Date.now().toString(36);

test("liveness, readiness and the health summary", async ({ request }) => {
  const live = await request.get("/api/health/live");
  expect(live.status()).toBe(200);
  const ready = await request.get("/api/health/ready");
  expect(ready.status()).toBe(200);
  const body = await ready.json();
  expect(body.checks.database.ok).toBe(true);
  expect(body.checks.migrations.ok).toBe(true);
  expect(Array.isArray(body.breakers)).toBe(true);
});

test("Prometheus metrics are exposed and every response carries a request id", async ({ request }) => {
  const res = await request.get("/api/properties?limit=1", { headers: { "X-Request-Id": `e2e-${RUN}-trace` } });
  expect(res.headers()["x-request-id"]).toBe(`e2e-${RUN}-trace`);
  expect(res.headers()["cache-control"]).toContain("s-maxage");
  const metricsRes = await request.get("/api/metrics");
  if (process.env.E2E_BASE_URL) {
    // Through the gateway / in production, metrics must not be public (Prometheus scrapes pods directly).
    expect([403, 404]).toContain(metricsRes.status());
  } else {
    const metrics = await metricsRes.text();
    expect(metrics).toContain("http_request_duration_seconds_bucket");
    expect(metrics).toContain('route="/api/properties"');
  }
});
