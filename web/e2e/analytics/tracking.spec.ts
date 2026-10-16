import { expect, test, type Page } from "@playwright/test";
import { closeDb, db, eventsForSession, waitFor } from "../helpers";

test.afterAll(closeDb);

const sessionId = (page: Page) => page.evaluate(() => (JSON.parse(sessionStorage.getItem("sa_sid") ?? "null") as { id: string } | null)?.id ?? null);

test("demo site: consent → search → detail → contact; events persist as synthetic", async ({ page }) => {
  await page.goto("/demo-site/index.html");
  const banner = page.getByRole("dialog", { name: "Analytics consent" });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Allow analytics" }).click();
  await page.evaluate("window.SuretteAnalytics.page()");

  await page.getByLabel("City").selectOption("Lakeview");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.locator(".card")).toHaveCount(2);
  await page.locator(".card").first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("12 Birch Lane");
  await page.getByRole("link", { name: "Request a showing" }).click();
  await page.getByLabel("Name").fill("Pat Tester");
  await page.getByLabel("Email").fill("pat@example.com");
  await page.getByLabel("Message").fill("Private message that must never be stored");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Thanks. (Demo: nothing was sent.)")).toBeVisible();

  const sid = await sessionId(page);
  expect(sid).toBeTruthy();
  const events = await waitFor(() => eventsForSession(sid!), (e) => e.some((x) => x.type === "showing_request_submit"));
  const types = events.map((e) => e.type);
  for (const t of ["page_view", "search_submit", "property_card_click", "property_view", "form_start", "showing_request_submit"]) expect(types).toContain(t);
  expect(new Set(events.map((e) => e.data_class))).toEqual(new Set(["synthetic"]));
  expect(new Set(events.map((e) => e.project_key))).toEqual(new Set(["demo-site"]));
  // Form contents are never captured.
  expect(JSON.stringify(events)).not.toMatch(/Pat Tester|pat@example\.com|Private message/);
});

test("Surette Nexus site: a consented visit is recorded as production data for nexus-site", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await page.goto("/listings");
  await page.locator("[data-sa-property-card]").first().click();
  await expect(page).toHaveURL(/\/listings\/.+/);
  await page.evaluate("window.SuretteAnalytics && window.SuretteAnalytics.flush()");
  const sid = await sessionId(page);
  expect(sid).toBeTruthy();
  const events = await waitFor(() => eventsForSession(sid!), (e) => e.some((x) => x.type === "property_view"));
  const types = events.map((e) => e.type);
  for (const t of ["page_view", "property_card_click", "property_view"]) expect(types).toContain(t);
  expect(new Set(events.map((e) => e.project_key))).toEqual(new Set(["nexus-site"]));
  expect(new Set(events.map((e) => e.data_class))).toEqual(new Set(["production"]));
  // Clean up so test visits don't count as real traffic (close first: leaving the page sends a final engagement event).
  await page.close({ runBeforeUnload: true });
  // Leaving the page sends a final beacon that can land a moment later: keep deleting until quiet.
  for (let quiet = 0, i = 0; quiet < 3 && i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const { rowCount } = await db().query("DELETE FROM analytics_events WHERE session_id = $1", [sid]);
    quiet = rowCount ? 0 : quiet + 1;
  }
});

test("Surette Nexus site: visitors who never answer the consent banner send nothing (opt-in)", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (r) => r.url().includes("/api/analytics/collect") && posts.push(r.url()));
  for (const path of ["/", "/market", "/team", "/listings"]) {
    await page.goto(path);
    await page.waitForLoadState("load");
    await page.mouse.wheel(0, 2000);
  }
  await page.locator("[data-sa-property-card]").first().click();
  await expect(page).toHaveURL(/\/listings\/.+/);
  await page.waitForTimeout(1500);
  expect(posts).toHaveLength(0);
});

test("demo site: declining consent sends nothing", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (r) => r.url().includes("/api/analytics/collect") && posts.push(r.url()));
  await page.goto("/demo-site/index.html");
  await page.getByRole("button", { name: "No thanks" }).click();
  await page.locator(".card").first().click();
  await page.evaluate("window.SuretteAnalytics.flush()");
  await page.waitForTimeout(1500);
  expect(posts).toHaveLength(0);
});

test("Global Privacy Control is honored without a banner choice", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (r) => r.url().includes("/api/analytics/collect") && posts.push(r.url()));
  await page.addInitScript(() => Object.defineProperty(navigator, "globalPrivacyControl", { value: true }));
  await page.goto("/demo-site/index.html");
  await expect(page.getByRole("dialog", { name: "Analytics consent" })).toBeHidden();
  await page.evaluate("window.SuretteAnalytics.track('cta_click', { cta: 'x' })");
  await page.evaluate("window.SuretteAnalytics.flush()");
  await page.waitForTimeout(1000);
  expect(posts).toHaveLength(0);
});

test("the site keeps working when analytics is down", async ({ page }) => {
  await page.route("**/api/analytics/collect", (r) => r.abort());
  await page.route("**/sdk/surette-analytics.js", (r) => r.abort());
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/demo-site/index.html");
  await expect(page.locator(".card")).toHaveCount(6);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.goto("/listings");
  await expect(page.locator("[data-sa-property-card]").first()).toBeVisible();
  expect(errors).toEqual([]);
});
