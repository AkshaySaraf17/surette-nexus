import { expect, test } from "@playwright/test";
import { closeDb, db, signIn } from "../helpers";

/** Deal handling in the property-management portal. */
const RUN = Date.now().toString(36);
test.afterAll(async () => {
  await db().query("DELETE FROM transactions WHERE client_name LIKE 'E2E %'");
  await closeDb();
});

test("an agent creates a deal from the board and lands on its checklist", async ({ page }) => {
  await signIn(page.request, "agent");
  await page.goto("/admin/deals");
  await page.getByRole("button", { name: "New deal" }).click();
  await page.locator("#d-client").fill(`E2E ${RUN} Buyer`);
  await page.locator("#d-side").selectOption("buyer");
  await page.getByRole("button", { name: "Create deal" }).click();
  await expect(page).toHaveURL(/\/admin\/deals\/[0-9a-f-]{36}/, { timeout: 15_000 });
  await expect(page.getByText(`E2E ${RUN} Buyer`).first()).toBeVisible();
  await expect(page.getByText(/milestone|checklist|task/i).first()).toBeVisible();
});

test("stage gates: under contract needs a contract date and price", async ({ request }) => {
  await signIn(request, "agent");
  const created = await request.post("/api/deals", { data: { title: `E2E ${RUN} gate`, side: "buyer", clientName: `E2E ${RUN} Gate` }, headers: { Origin: "http://localhost:3100" } });
  const { id } = await created.json();
  const blocked = await request.patch(`/api/deals/${id}`, { data: { stage: "under_contract" }, headers: { Origin: "http://localhost:3100" } });
  expect(blocked.status()).toBe(400);
  expect((await blocked.json()).error.fields).toHaveProperty("contractDate");
});
