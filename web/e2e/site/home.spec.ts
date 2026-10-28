import { expect, test } from "@playwright/test";

/** Home page: photos in simple boxes, nothing that moves while you scroll, and no drone footage anywhere. */
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
  const scenes = page.getByRole("region", { name: "Inside the homes we represent" });
  await scenes.scrollIntoViewIfNeeded();
  await expect(scenes.locator("img")).toHaveCount(4);
  expect(requested.filter((u) => /orbit|drone|hero-orbit|aerial-foliage/.test(u))).toEqual([]);
});

test("nothing moves on its own while you scroll", async ({ page }) => {
  await page.goto("/");
  // Measure only after everything above has loaded (listing cards stream in and push content down once).
  await page.waitForLoadState("networkidle");
  await expect(page.locator("[data-sa-property-card]").first()).toBeVisible();
  // Content scrolls exactly with the page: no sticky panels, no parallax, no scroll-linked fades.
  const sticky = await page.evaluate(() => [...document.querySelectorAll("main *")].filter((el) => getComputedStyle(el).position === "sticky").length);
  expect(sticky).toBe(0);
  const heading = page.getByRole("heading", { name: "Inside the homes we represent" });
  const before = await heading.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  await page.mouse.wheel(0, 1500);
  await page.waitForTimeout(400);
  const after = await heading.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  expect(Math.abs(after - before)).toBeLessThan(1);
  expect(await page.evaluate(() => document.documentElement.classList.contains("lenis"))).toBe(false);
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
  for (const path of ["/", "/scroll-version", "/listings", "/market", "/dual-move", "/contact"]) {
    await page.goto(path);
    await page.waitForLoadState("load");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), path).toBeLessThanOrEqual(0);
  }
  await ctx.close();
});

test("the scroll version keeps the old effects, and they stop when you go back to the simple home page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Scroll version" }).click();
  await expect(page).toHaveURL(/\/scroll-version$/);
  await expect(page.getByRole("heading", { name: "The earlier, scroll-animated home page" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("lenis"))).toBe(true);
  expect(await page.evaluate(() => [...document.querySelectorAll("main *")].filter((el) => getComputedStyle(el).position === "sticky").length)).toBeGreaterThan(0);

  // In-app navigation back to the simple page: smooth scrolling and colour changes are switched off.
  await page.getByRole("link", { name: "See the simple version" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("lenis"))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--tone-bg"))).toBe("");
});
