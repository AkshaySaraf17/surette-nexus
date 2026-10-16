import { expect, test } from "@playwright/test";

/** The Dual-Move Copilot computes a plan from the visitor's own assumptions — and invents none. */
test("nothing is assumed until the visitor fills in their numbers", async ({ page }) => {
  await page.goto("/dual-move");
  await expect(page.getByRole("region", { name: "Results" })).toContainText(/never fill in rates or prices/i);
});

test("results update from the inputs and show the money needed and monthly payment", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("sa_consent", "denied"));
  await page.goto("/dual-move");
  await page.getByRole("button", { name: "Fill an example" }).click();
  // Rates are never assumed: take the published Freddie Mac average (the example sells first, so no bridge loan).
  await page.getByRole("button", { name: "Use it" }).click();
  const results = page.getByRole("region", { name: "Results" });
  await expect(results).toContainText(/\$\d/);
  const before = await results.innerText();
  const price = page.locator("#dm-newPrice");
  await price.fill("650000");
  await price.blur();
  await expect.poll(async () => (await results.innerText()) !== before).toBe(true);
  await expect(results).toContainText(/month/i);
});
