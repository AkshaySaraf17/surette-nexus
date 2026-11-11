import { expect, test } from "@playwright/test";
import { closeDb, db, ownClientIp } from "../helpers";

/**
 * Feedback from the Surette team (Oct 2026): off-market alerts as a lead magnet, camps & cottages
 * and other home styles as collections, commute search, and no leasing/management services.
 */
test.use({ extraHTTPHeaders: ownClientIp(41) });
test.afterAll(closeDb);
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("sa_consent", "denied"));
});

test("an off-market sign-up becomes a lead with the buyer's wish list", async ({ page }) => {
  const email = `off-market-${Date.now()}@example.test`;
  await page.goto("/off-market");
  await page.getByRole("button", { name: "Camps & cottages" }).click();
  await page.getByRole("button", { name: "Belgrade" }).click();
  await page.getByLabel("Budget").selectOption({ label: "Up to $350K" });
  await page.getByLabel("Name", { exact: true }).fill("E2E Off-Market Buyer");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Get off-market alerts" }).click();
  // Consent is required before anything is sent.
  await expect(page.getByText("Please confirm we may contact you about this request.")).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Get off-market alerts" }).click();
  await expect(page.getByRole("status")).toContainText("You’re on the list");

  const { rows } = await db().query("SELECT source, message, preferences FROM leads WHERE contact_email = $1", [email]);
  expect(rows).toHaveLength(1);
  expect(rows[0].source).toBe("off_market");
  expect(rows[0].message).toContain("Camps & cottages");
  expect(rows[0].preferences).toMatchObject({ styles: ["camps-cottages"], towns: ["Belgrade"], maxPriceCents: 35_000_000 });
  await db().query("DELETE FROM leads WHERE contact_email = $1", [email]);
});

test("the embeddable form can be framed by other sites; the rest of the site cannot", async ({ request }) => {
  const embed = await request.get("/embed/off-market");
  expect(embed.headers()["x-frame-options"]).toBeUndefined();
  expect(embed.headers()["content-security-policy"]).toMatch(/frame-ancestors 'self' /);
  const home = await request.get("/");
  expect(home.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  expect(home.headers()["content-security-policy"]).toContain("frame-ancestors 'self'");
});

test("home-style boxes open the matching homes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Camps & cottages.*Summers at camp/ }).click();
  await expect(page).toHaveURL(/style=camps-cottages/);
  await expect(page.getByText("Long Pond Camp").first()).toBeVisible();
  await expect(page.getByText("Messalonskee Lake House").filter({ visible: true })).toHaveCount(0);
});

test("commute filter keeps only homes within the chosen drive", async ({ page }) => {
  await page.goto("/listings?driveTo=portland&maxDrive=60");
  await expect(page.getByText(/No homes match/).first()).toBeVisible();
  await page.goto("/listings?driveTo=downtown&maxDrive=15");
  await expect(page.getByText("The Kennebec Federal").first()).toBeVisible();
  await expect(page.getByText("Long Pond Camp").filter({ visible: true })).toHaveCount(0);
});

test("the site no longer offers leasing or property management services", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Leasing & management")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Camps & cottages" })).toBeVisible();
  await expect(page.getByRole("contentinfo")).not.toContainText(/property management|tenant maintenance/i);
});
