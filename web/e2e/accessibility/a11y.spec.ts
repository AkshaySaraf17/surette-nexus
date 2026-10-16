import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "../helpers";

/**
 * Automated accessibility checks (axe-core, WCAG 2.1 A/AA rules) on the main pages.
 * Fails on serious or critical violations. Automated checks catch roughly a third of
 * issues — keyboard and screen-reader passes are still needed by hand.
 */
async function audit(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("load");
  await page.waitForTimeout(800);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`), path).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("sa_consent", "denied"));
});

test("home page, section by section as a visitor scrolls", async ({ page }) => {
  // The home page re-tints its background as you scroll (data-tone). Contrast is only meaningful
  // for a section while it's on screen, so scroll each one into view and audit it there.
  await page.goto("/");
  await page.waitForLoadState("load");
  const count = await page.evaluate(() => {
    const sections = [...document.querySelectorAll("main section, body > div section")].filter((s) => !s.parentElement?.closest("section"));
    sections.forEach((s, i) => s.setAttribute("data-a11y", String(i)));
    return sections.length;
  });
  const problems: string[] = [];
  for (let i = 0; i < count; i++) {
    await page.evaluate((n) => document.querySelector(`[data-a11y="${n}"]`)?.scrollIntoView({ block: "start" }), i);
    await page.waitForTimeout(900);
    const r = await new AxeBuilder({ page }).include(`[data-a11y="${i}"]`).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    for (const v of r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")) problems.push(`section ${i}: ${v.id} — ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
  }
  expect(problems).toEqual([]);
});

for (const path of ["/listings", "/listings/orchard-hill-farmhouse-sidney", "/market", "/dual-move", "/contact", "/team", "/privacy", "/sign-in", "/portal/sign-in"]) {
  test(`public page ${path}`, async ({ page }) => audit(page, path));
}

for (const path of ["/admin", "/admin/deals", "/admin/leads", "/admin/listings"]) {
  test(`portal page ${path}`, async ({ page }) => {
    await signIn(page.request, "owner");
    await audit(page, path);
  });
}
