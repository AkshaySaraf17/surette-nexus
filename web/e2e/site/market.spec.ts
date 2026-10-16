import { expect, test } from "@playwright/test";

/** The market dashboard shows real government data with its sources. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("sa_consent", "denied"));
  await page.goto("/market");
});

test("community profile shows Census figures for Waterville with margins of error", async ({ page }) => {
  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  const row = table.getByRole("row", { name: /^Waterville/ });
  await expect(row).toContainText(/\$\d{3},\d{3}/); // median home value
  await expect(row).toContainText("±");
  for (const area of ["Augusta", "Oakland", "Kennebec County, ME", "Maine", "United States"]) await expect(table.getByRole("rowheader", { name: area })).toBeVisible();
});

test("unemployment, permits and county price index charts load", async ({ page }) => {
  for (const [tab, area] of [["Unemployment", "Kennebec County, ME"], ["New homes permitted", "Somerset County, ME"], ["County price index", "Maine"]] as const) {
    await page.getByRole("tab", { name: tab }).click();
    const chart = page.getByRole("img", { name: new RegExp(`^${tab} .*over the last`) });
    await expect(chart).toBeVisible();
    await expect(chart).toHaveAttribute("aria-label", new RegExp(area));
    await expect(chart.locator(".recharts-line-curve").first()).toBeVisible();
  }
});

test("every government source is listed with its agency", async ({ page }) => {
  const sources = page.getByRole("region", { name: "Government data sources" });
  for (const agency of ["U.S. Census Bureau", "U.S. Bureau of Labor Statistics", "Federal Housing Finance Agency"]) await expect(sources).toContainText(agency);
  const api = await (await page.request.get("/api/market/datasets")).json();
  expect(api.datasets.map((d: { dataset: string }) => d.dataset).sort()).toEqual(["acs5", "bls_laus", "census_bps", "fhfa_hpi"]);
});
