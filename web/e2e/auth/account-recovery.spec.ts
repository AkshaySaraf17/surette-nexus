import { expect, test, type Page } from "@playwright/test";
import { BASE, closeDb, db, waitFor } from "../helpers";

/**
 * Customer account emails, end to end: sign-up → confirmation email → verified; forgot → reset
 * email → new password. Emails are read from Mailpit (the free local test inbox, :8025), which
 * the worker delivers to over SMTP — so this also covers the queue → worker → SMTP path.
 */
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
const stamp = Date.now();
const NEW_USER = { name: "E2E Verify Person", email: `e2e-verify-${stamp}@example.com`, password: "first-pass-2026" };
const headers = { Origin: new URL(BASE).origin };
// Its own client address, so these sign-ins don't use up the per-address login limit (20 per 15 min) of the rest of the suite.
test.use({ extraHTTPHeaders: { "X-Real-IP": `10.201.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });

test.afterAll(async () => {
  await db().query("DELETE FROM users WHERE email LIKE 'e2e-verify-%@example.com'");
  await closeDb();
});

async function linkFromEmail(to: string, path: string): Promise<string> {
  const pattern = new RegExp(`https?://\\S+${path}\\?token=[A-Za-z0-9_-]+`);
  const findLink = async () => {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const messages = ((await res.json()) as { messages: { ID: string; Created: string }[] }).messages ?? [];
    for (const m of messages.sort((a, b) => b.Created.localeCompare(a.Created))) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text: string };
      const match = msg.Text.match(pattern);
      if (match) return match[0];
    }
    return null;
  };
  const link = await waitFor(findLink, (l) => l !== null, 20_000);
  expect(link, `an email to ${to} with a ${path} link`).not.toBeNull();
  // Emails link to PUBLIC_SITE_URL; open the same path on the server under test.
  const url = new URL(link!);
  return `${url.pathname}${url.search}`;
}

async function anyPropertyId() {
  const { rows } = await db().query<{ id: string }>("SELECT id FROM properties WHERE status = 'active' LIMIT 1");
  return rows[0].id;
}

const save = (page: Page, propertyId: string) => page.request.post("/api/collections/save", { data: { propertyId, saved: true }, headers });

test.describe.serial("email verification and password reset", () => {
  test.beforeAll(async ({ request }) => {
    const providers = await (await request.get("/api/auth/providers")).json();
    test.skip(!providers.email, "Account emails are switched off on this server (ACCOUNT_EMAILS=off)");
  });

  test("sign-up sends a confirmation link; saving unlocks after clicking it", async ({ page }) => {
    await page.goto("/sign-in?mode=signup");
    await page.getByLabel("Full name").fill(NEW_USER.name);
    await page.getByLabel("Email").fill(NEW_USER.email);
    await page.getByLabel("Password").fill(NEW_USER.password);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.waitForURL(/\/account/);
    await expect(page.getByText("Confirm your email")).toBeVisible();

    const propertyId = await anyPropertyId();
    const blocked = await save(page, propertyId);
    expect(blocked.status()).toBe(403);
    expect((await blocked.json()).error.code).toBe("EMAIL_NOT_VERIFIED");

    const link = await linkFromEmail(NEW_USER.email, "/verify-email");
    await page.goto(link);
    await expect(page.getByText("Your email is confirmed.")).toBeVisible();
    expect((await save(page, propertyId)).status()).toBe(200);

    // The link is single-use.
    await page.goto(link);
    await expect(page.getByText(/invalid, expired or already used/)).toBeVisible();
  });

  test("forgot password: same answer for unknown emails, reset link works once and signs other sessions out", async ({ page, browser }) => {
    // An existing session that should stop working after the reset.
    const other = await browser.newContext({ baseURL: BASE });
    const login = await other.request.post("/api/auth/login", { data: { email: NEW_USER.email, password: NEW_USER.password, audience: "customer" }, headers });
    expect(login.ok()).toBe(true);
    expect((await other.request.get("/api/auth/me")).ok()).toBe(true);

    const unknown = await page.request.post("/api/auth/password/forgot", { data: { email: `nobody-${stamp}@example.com` }, headers });
    const known = await page.request.post("/api/auth/password/forgot", { data: { email: NEW_USER.email }, headers });
    expect(unknown.status()).toBe(200);
    expect(await unknown.json()).toEqual(await known.json());

    const link = await linkFromEmail(NEW_USER.email, "/reset-password");
    await page.goto(link);
    await page.getByLabel("New password", { exact: true }).fill("second-pass-2026");
    await page.getByLabel("Confirm new password").fill("second-pass-2026");
    await page.getByRole("button", { name: "Save new password" }).click();
    await page.waitForURL(/\/account/);

    expect((await other.request.get("/api/auth/me")).status()).toBe(401);
    await other.close();

    const oldPass = await page.request.post("/api/auth/login", { data: { email: NEW_USER.email, password: NEW_USER.password, audience: "customer" }, headers });
    expect(oldPass.status()).toBe(401);
    const newPass = await page.request.post("/api/auth/login", { data: { email: NEW_USER.email, password: "second-pass-2026", audience: "customer" }, headers });
    expect(newPass.ok()).toBe(true);

    const reuse = await page.request.post("/api/auth/password/reset", { data: { token: new URL(link, BASE).searchParams.get("token"), password: "third-pass-2026" }, headers }); // gitleaks:allow (test password)
    expect(reuse.status()).toBe(400);
  });

  test("the forgot-password page shows the same confirmation for any email", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await page.waitForURL(/\/forgot-password/);
    await page.waitForLoadState("networkidle");
    await page.getByRole("textbox", { name: "Email" }).fill(`nobody-ui-${stamp}@example.com`);
    await page.getByRole("button", { name: "Email me a reset link" }).click();
    await expect(page.getByRole("status")).toContainText("If an account exists");
  });
});

test("with account emails off, sign-up is confirmed at once and Forgot password is hidden", async ({ page, request }) => {
  const providers = await (await request.get("/api/auth/providers")).json();
  test.skip(providers.email, "Account emails are on on this server");
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveCount(0);
  const res = await request.post("/api/auth/password/forgot", { data: { email: "someone@example.com" }, headers });
  expect(res.status()).toBe(503);
  expect((await res.json()).error.code).toBe("EMAIL_OFF");
});

test("Google sign-in stays hidden and refuses to start until it's configured", async ({ page, request }) => {
  const providers = await (await request.get("/api/auth/providers")).json();
  test.skip(providers.google, "Google is configured on this server");
  await page.goto("/sign-in");
  await expect(page.getByRole("link", { name: /Continue with Google/ })).toHaveCount(0);
  const res = await request.get("/api/auth/google/start", { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers().location).toContain("/sign-in?error=google_off");
});
