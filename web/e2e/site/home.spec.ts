import { expect, test } from "@playwright/test";

/** Home page media: photo slideshow and stacked scenes — and no drone footage anywhere. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("sa_consent", "denied"));
});

test("the hero shows house photos and the page never requests drone media", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (r) => requested.push(r.url()));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("sense");
  const hero = page.locator('section[aria-label="Introduction"] img').first();
  await expect(hero).toBeVisible();
  expect(await hero.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.locator('[aria-label="Inside the homes we represent"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[aria-label="Inside the homes we represent"] img')).toHaveCount(4);
  expect(requested.filter((u) => /orbit|drone|hero-orbit|aerial-foliage/.test(u))).toEqual([]);
});

test("the hero search takes you to matching homes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Search" }).first().click();
  await expect(page).toHaveURL(/\/listings/);
  await expect(page.locator("[data-sa-property-card]").first()).toBeVisible();
});

test("no horizontal scrolling on a phone", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await ctx.newPage();
  for (const path of ["/", "/listings", "/market", "/dual-move", "/contact"]) {
    await page.goto(path);
    await page.waitForLoadState("load");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), path).toBeLessThanOrEqual(0);
  }
  await ctx.close();
});
