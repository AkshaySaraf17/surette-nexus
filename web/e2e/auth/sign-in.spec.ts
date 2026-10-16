import { expect, test } from "@playwright/test";
import { closeDb, db } from "../helpers";

test.afterAll(async () => {
  // Remove leads created by these tests so they never look like real inquiries.
  await db().query("DELETE FROM leads WHERE contact_name LIKE 'E2E %'");
  await closeDb();
});

/** Two separate entrances: customers at /sign-in, the property-management team at /portal/sign-in. */
const OWNER = { email: "owner@surette.test", password: "surette-owner-2026" };
const AGENT = { email: "agent@surette.test", password: "surette-agent-2026" };
const CLIENT = { email: "client@surette.test", password: "surette-client-2026" };

test("anonymous visitors are sent to the team sign-in from the portal", async ({ page }) => {
  await page.goto("/admin/deals");
  await expect(page).toHaveURL(/\/portal\/sign-in/);
});

test("the customer sign-in refuses a staff account and points to the portal", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(AGENT.email);
  await page.getByLabel("Password").fill(AGENT.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("link", { name: /team sign-in/i }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);
});

test("the team sign-in refuses a customer account", async ({ page }) => {
  await page.goto("/portal/sign-in");
  await page.getByLabel("Work email").fill(CLIENT.email);
  await page.getByLabel("Password").fill(CLIENT.password);
  await page.getByRole("button", { name: "Sign in to the portal" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/portal\/sign-in/);
});

test("a customer signs in to their account and can't open the portal", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(CLIENT.email);
  await page.getByLabel("Password").fill(CLIENT.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/account/);
  await page.goto("/admin");
  await expect(page).not.toHaveURL(/\/admin/);
  const res = await page.request.get("/api/leads");
  expect(res.status()).toBe(403);
});

test("an agent signs in to the portal and sees the dashboard and deals board", async ({ page }) => {
  await page.goto("/portal/sign-in");
  await page.getByLabel("Work email").fill(AGENT.email);
  await page.getByLabel("Password").fill(AGENT.password);
  await page.getByRole("button", { name: "Sign in to the portal" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)/ })).toBeVisible();
  await page.goto("/admin/deals");
  await expect(page.getByText("Prospect").first()).toBeVisible();
  // Owner-only screens stay closed to agents.
  expect((await page.request.get("/api/analytics/overview?project=nexus-site")).status()).toBe(403);
});

test("a website contact creates a lead the owner sees in the portal", async ({ page, browser }) => {
  const stamp = `E2E ${Date.now()}`;
  await page.goto("/contact");
  await page.locator("#c-name").fill(stamp);
  await page.locator("#c-email").fill(`e2e+${Date.now()}@example.com`);
  await page.getByLabel("How can we help?").fill("Looking for a 3 bedroom in Waterville.");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/thank|got it|received/i).first()).toBeVisible();

  const owner = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const op = await owner.newPage();
  await op.goto("/portal/sign-in");
  await op.getByLabel("Work email").fill(OWNER.email);
  await op.getByLabel("Password").fill(OWNER.password);
  await op.getByRole("button", { name: "Sign in to the portal" }).click();
  await expect(op).toHaveURL(/\/admin$/);
  await op.goto("/admin/leads");
  await expect(op.getByText(stamp).first()).toBeVisible();
  await owner.close();
});
