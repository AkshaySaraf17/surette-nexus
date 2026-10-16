import { describe, expect, it } from "vitest";
import { analyze, breakdown, dualMoveInputSchema, knownAmounts, monthlyPrincipalInterest, pct, type DualMoveInput } from "@/lib/dual-move";

const base: DualMoveInput = {
  homeValueCents: 40_000_000, // $400,000
  mortgageBalanceCents: 15_000_000,
  sellingCostBps: 600,
  prepCostsCents: 600_000,
  newPriceCents: 50_000_000, // $500,000
  savingsCents: 2_000_000,
  downPaymentBps: 2000,
  buyerClosingCostBps: 300,
  rateBps: 650,
  termYears: 30,
  propertyTaxAnnualCents: 600_000,
  insuranceAnnualCents: 180_000,
  hoaMonthlyCents: 0,
  movingCostsCents: 400_000,
  timelineMonths: 6,
  sellFirst: true,
  overlapMonths: 3,
  currentMonthlyHousingCents: 200_000,
  bridgeRateBps: 800,
};

describe("dual-move math (integer cents)", () => {
  it("pct rounds half-up", () => {
    expect(pct(10_000, 650)).toBe(650);
    expect(pct(3, 5000)).toBe(2); // 1.5 → 2
    expect(pct(1, 4999)).toBe(0);
  });

  it("matches the standard amortization formula", () => {
    expect(monthlyPrincipalInterest(40_000_000, 650, 30)).toBe(252_827); // $2,528.27
    expect(monthlyPrincipalInterest(36_000, 0, 30)).toBe(100);
    expect(monthlyPrincipalInterest(0, 650, 30)).toBe(0);
  });

  it("sell-first breakdown", () => {
    const b = breakdown(base);
    expect(b.sellingCostsCents).toBe(2_400_000);
    expect(b.netProceedsCents).toBe(22_000_000); // 400k − 24k − 6k − 150k
    expect(b.downPaymentCents).toBe(10_000_000);
    expect(b.buyerClosingCostsCents).toBe(1_500_000);
    expect(b.cashNeededCents).toBe(11_900_000);
    expect(b.cashAvailableCents).toBe(24_000_000);
    expect(b.gapCents).toBe(-12_100_000); // surplus
    expect(b.monthlyHousingCents).toBe(252_827 + 50_000 + 15_000);
    expect(b.bridgeNeededCents).toBe(0);
  });

  it("buy-first needs bridge financing and carries both homes", () => {
    const b = breakdown({ ...base, sellFirst: false });
    expect(b.bridgeNeededCents).toBe(9_900_000);
    expect(b.overlapCarryingCents).toBe(600_000);
    expect(b.bridgeInterestCents).toBe(198_000); // 99k × 8% × 3/12
    expect(b.gapCents).toBe(0);
  });

  it("underwater sale shows up as a gap and a plain-language warning", () => {
    const r = analyze({ ...base, mortgageBalanceCents: 42_000_000 });
    expect(r.expected.netProceedsCents).toBeLessThan(0);
    expect(r.gaps.join(" ")).toMatch(/doesn't cover the mortgage/);
  });

  it("scenarios are labeled and the stress case is never better than expected", () => {
    const r = analyze(base);
    expect(r.scenarios.map((s) => s.key)).toEqual(["conservative", "expected", "stress"]);
    expect(r.scenarios[2].result.gapCents).toBeGreaterThanOrEqual(r.scenarios[1].result.gapCents);
    expect(r.scenarios[1].result).toEqual(r.expected);
  });

  it("knownAmounts contains the headline numbers the AI may cite", () => {
    const r = analyze(base);
    const known = knownAmounts(r, base);
    expect(known).toContain(r.expected.netProceedsCents);
    expect(known).toContain(r.expected.monthlyPrincipalInterestCents);
  });

  it("schema rejects fractional cents and absurd inputs", () => {
    expect(dualMoveInputSchema.safeParse({ ...base, homeValueCents: 100.5 }).success).toBe(false);
    expect(dualMoveInputSchema.safeParse({ ...base, rateBps: 9000 }).success).toBe(false);
    expect(dualMoveInputSchema.safeParse({ ...base, homeValueCents: 0 }).success).toBe(false);
    expect(dualMoveInputSchema.safeParse(base).success).toBe(true);
  });
});
