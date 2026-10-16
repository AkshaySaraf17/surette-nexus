/**
 * Dual-Move Copilot calculations: sell a current home and buy the next one.
 *
 * Deterministic and transparent. Money is integer cents; percentages and rates are basis
 * points (bps; 650 = 6.50%). The only floating-point step is the amortization power term,
 * whose result is rounded to whole cents once.
 *
 * These are estimates from the user's own assumptions — not a mortgage approval, appraisal,
 * or legal, tax or financial advice. Nothing here looks up rates, taxes or home values.
 */
import { z } from "zod";

const cents = (max = 100_000_000_000) => z.number().int("Whole cents only.").min(0, "Can't be negative.").max(max, "That's too large.");
const bps = (max: number) => z.number().int().min(0, "Can't be negative.").max(max, `Must be ${max / 100}% or less.`);

export const dualMoveInputSchema = z
  .object({
    homeValueCents: cents().refine((v) => v > 0, "Enter your home's estimated value."),
    mortgageBalanceCents: cents(),
    sellingCostBps: bps(1500),
    prepCostsCents: cents(),
    newPriceCents: cents().refine((v) => v > 0, "Enter the price of the home you want to buy."),
    savingsCents: cents(),
    downPaymentBps: bps(10_000),
    buyerClosingCostBps: bps(1000),
    rateBps: bps(2500),
    termYears: z.number().int().min(5, "At least 5 years.").max(40, "At most 40 years."),
    propertyTaxAnnualCents: cents(),
    insuranceAnnualCents: cents(),
    hoaMonthlyCents: cents(),
    movingCostsCents: cents(),
    timelineMonths: z.number().int().min(1).max(36),
    sellFirst: z.boolean(),
    overlapMonths: z.number().int().min(0).max(24),
    currentMonthlyHousingCents: cents(),
    bridgeRateBps: bps(2500),
  })
  .refine((v) => v.mortgageBalanceCents <= v.homeValueCents * 2, { path: ["mortgageBalanceCents"], message: "Check the mortgage balance — it's far above the home value." });

export type DualMoveInput = z.infer<typeof dualMoveInputSchema>;

/** x × bps / 10 000, rounded half-up to whole cents. */
export function pct(amountCents: number, basisPoints: number): number {
  return Math.floor((amountCents * basisPoints + 5_000) / 10_000);
}

/**
 * Monthly principal & interest: P × r / (1 − (1 + r)^−n), r = annual rate / 12, n = years × 12.
 * At 0% it's P / n. Result rounded to the nearest cent.
 */
export function monthlyPrincipalInterest(loanCents: number, rateBps: number, termYears: number): number {
  if (loanCents <= 0) return 0;
  const n = termYears * 12;
  if (rateBps === 0) return Math.round(loanCents / n);
  const r = rateBps / 10_000 / 12;
  return Math.round((loanCents * r) / (1 - Math.pow(1 + r, -n)));
}

export interface Breakdown {
  salePriceCents: number;
  sellingCostsCents: number;
  prepCostsCents: number;
  mortgagePayoffCents: number;
  netProceedsCents: number; // may be negative (owes more than the sale nets)
  downPaymentCents: number;
  buyerClosingCostsCents: number;
  movingCostsCents: number;
  cashNeededCents: number;
  cashAvailableCents: number;
  gapCents: number; // > 0 means a shortfall
  loanCents: number;
  monthlyPrincipalInterestCents: number;
  monthlyTaxCents: number;
  monthlyInsuranceCents: number;
  monthlyHoaCents: number;
  monthlyHousingCents: number;
  bridgeNeededCents: number;
  overlapCarryingCents: number;
  bridgeInterestCents: number;
  transitionCostsCents: number;
}

export function breakdown(i: DualMoveInput): Breakdown {
  const sellingCosts = pct(i.homeValueCents, i.sellingCostBps);
  const netProceeds = i.homeValueCents - sellingCosts - i.prepCostsCents - i.mortgageBalanceCents;
  const downPayment = pct(i.newPriceCents, i.downPaymentBps);
  const closing = pct(i.newPriceCents, i.buyerClosingCostBps);
  const cashNeeded = downPayment + closing + i.movingCostsCents;
  // Selling first: proceeds are in hand. Buying first: only savings are available at purchase.
  const cashAvailable = i.sellFirst ? Math.max(0, netProceeds) + i.savingsCents : i.savingsCents;
  const bridgeNeeded = i.sellFirst ? 0 : Math.max(0, cashNeeded - i.savingsCents);
  const loan = Math.max(0, i.newPriceCents - downPayment);
  const pi = monthlyPrincipalInterest(loan, i.rateBps, i.termYears);
  const tax = Math.round(i.propertyTaxAnnualCents / 12);
  const ins = Math.round(i.insuranceAnnualCents / 12);
  const overlap = i.sellFirst ? 0 : i.overlapMonths;
  const overlapCarrying = overlap * i.currentMonthlyHousingCents;
  const bridgeInterest = Math.round((bridgeNeeded * i.bridgeRateBps * overlap) / 10_000 / 12);
  const gap = i.sellFirst ? cashNeeded - cashAvailable : Math.max(0, cashNeeded - i.savingsCents - bridgeNeeded) + Math.max(0, -netProceeds);
  return {
    salePriceCents: i.homeValueCents,
    sellingCostsCents: sellingCosts,
    prepCostsCents: i.prepCostsCents,
    mortgagePayoffCents: i.mortgageBalanceCents,
    netProceedsCents: netProceeds,
    downPaymentCents: downPayment,
    buyerClosingCostsCents: closing,
    movingCostsCents: i.movingCostsCents,
    cashNeededCents: cashNeeded,
    cashAvailableCents: cashAvailable,
    gapCents: gap,
    loanCents: loan,
    monthlyPrincipalInterestCents: pi,
    monthlyTaxCents: tax,
    monthlyInsuranceCents: ins,
    monthlyHoaCents: i.hoaMonthlyCents,
    monthlyHousingCents: pi + tax + ins + i.hoaMonthlyCents,
    bridgeNeededCents: bridgeNeeded,
    overlapCarryingCents: overlapCarrying,
    bridgeInterestCents: bridgeInterest,
    transitionCostsCents: i.movingCostsCents + overlapCarrying + bridgeInterest + i.prepCostsCents,
  };
}

/** Scenario adjustments (all clearly labeled as assumptions in the UI). */
export const SCENARIOS = {
  conservative: { label: "Conservative", note: "Sale 3% lower, rate +0.25 pt, prep and moving +10%.", saleBps: -300, rateBps: 25, costBps: 1000, overlap: 0 },
  expected: { label: "Expected", note: "Exactly your assumptions.", saleBps: 0, rateBps: 0, costBps: 0, overlap: 0 },
  stress: { label: "Higher-cost", note: "Sale 8% lower, rate +1 pt, prep and moving +25%, 2 extra months of overlap if buying first.", saleBps: -800, rateBps: 100, costBps: 2500, overlap: 2 },
} as const;
export type ScenarioKey = keyof typeof SCENARIOS;

export function adjust(i: DualMoveInput, key: ScenarioKey): DualMoveInput {
  const s = SCENARIOS[key];
  return {
    ...i,
    homeValueCents: i.homeValueCents + pct(i.homeValueCents, s.saleBps),
    rateBps: i.rateBps + s.rateBps,
    prepCostsCents: i.prepCostsCents + pct(i.prepCostsCents, s.costBps),
    movingCostsCents: i.movingCostsCents + pct(i.movingCostsCents, s.costBps),
    overlapMonths: i.sellFirst ? i.overlapMonths : Math.min(24, i.overlapMonths + s.overlap),
  };
}

export interface TimelineStep {
  month: number;
  label: string;
  detail: string;
}

/** A typical sequence (assumption-based, editable by changing the timeline input). */
export function timeline(i: DualMoveInput): TimelineStep[] {
  const t = i.timelineMonths;
  const at = (fraction: number) => Math.max(0, Math.round(t * fraction));
  if (i.sellFirst) {
    return [
      { month: 0, label: "Talk with a lender & your agent", detail: "Confirm what you can borrow and price your current home." },
      { month: at(0.1), label: "Prepare and list your home", detail: "Repairs, staging, photos." },
      { month: at(0.4), label: "Accept an offer", detail: "Negotiate a closing date that leaves time to buy, or a rent-back." },
      { month: at(0.6), label: "Close the sale", detail: "Proceeds become available for your purchase." },
      { month: at(0.65), label: "Make an offer on the next home", detail: "Offer without a home-sale contingency." },
      { month: t, label: "Close on your new home & move", detail: "Possibly with short-term housing in between." },
    ];
  }
  return [
    { month: 0, label: "Talk with a lender about bridge options", detail: "Bridge loan, HELOC, or a home-sale contingency." },
    { month: at(0.15), label: "Make an offer on the next home", detail: "Down payment from savings and/or bridge financing." },
    { month: at(0.35), label: "Close on your new home & move", detail: "You may carry two homes for a period." },
    { month: at(0.45), label: "Prepare and list your previous home", detail: "Easier once it's empty." },
    { month: at(0.75), label: "Accept an offer", detail: "" },
    { month: t, label: "Close the sale & repay bridge financing", detail: `Assumes about ${i.overlapMonths} month(s) of overlap.` },
  ];
}

export function analyze(i: DualMoveInput) {
  const expected = breakdown(i);
  const scenarios = (Object.keys(SCENARIOS) as ScenarioKey[]).map((key) => ({ key, label: SCENARIOS[key].label, note: SCENARIOS[key].note, result: breakdown(adjust(i, key)) }));
  const priceScenarios = [-1000, 0, 1000].map((delta) => {
    const price = i.newPriceCents + pct(i.newPriceCents, delta);
    return { label: delta === 0 ? "Your target" : `${delta > 0 ? "+" : ""}${delta / 100}%`, newPriceCents: price, result: breakdown({ ...i, newPriceCents: price }) };
  });
  const downPaymentScenarios = [...new Set([500, 1000, 2000, i.downPaymentBps])].sort((a, b) => a - b).map((dp) => ({ downPaymentBps: dp, result: breakdown({ ...i, downPaymentBps: dp }) }));
  const sellVsBuy = { sellFirst: breakdown({ ...i, sellFirst: true }), buyFirst: breakdown({ ...i, sellFirst: false, overlapMonths: Math.max(i.overlapMonths, 1) }) };
  const rateSensitivity = [-100, -50, 0, 50, 100].map((d) => ({ rateBps: Math.max(0, i.rateBps + d), monthlyPrincipalInterestCents: monthlyPrincipalInterest(expected.loanCents, Math.max(0, i.rateBps + d), i.termYears) }));
  const saleSensitivity = [-1000, -500, 0, 500].map((d) => {
    const value = i.homeValueCents + pct(i.homeValueCents, d);
    return { saleChangeBps: d, salePriceCents: value, netProceedsCents: breakdown({ ...i, homeValueCents: value }).netProceedsCents };
  });

  const gaps: string[] = [];
  if (expected.netProceedsCents < 0) gaps.push("Your estimated sale doesn't cover the mortgage payoff and selling costs.");
  if (expected.gapCents > 0) gaps.push(`You'd be about ${money(expected.gapCents)} short of the cash needed at purchase.`);
  if (!i.sellFirst && expected.bridgeNeededCents > 0) gaps.push(`Buying first needs about ${money(expected.bridgeNeededCents)} of bridge financing until your sale closes.`);
  if (scenarios[2].result.gapCents > 0 && expected.gapCents <= 0) gaps.push(`In the higher-cost scenario there's a shortfall of about ${money(scenarios[2].result.gapCents)}.`);
  if (i.downPaymentBps < 2000) gaps.push("With less than 20% down, lenders usually require mortgage insurance, which isn't included here.");

  return { expected, scenarios, priceScenarios, downPaymentScenarios, sellVsBuy, rateSensitivity, saleSensitivity, timeline: timeline(i), gaps, summary: summary(i, expected) };
}

export function money(c: number): string {
  const sign = c < 0 ? "-" : "";
  return `${sign}$${Math.floor((Math.abs(c) + 50) / 100).toLocaleString("en-US")}`;
}

function summary(i: DualMoveInput, b: Breakdown): string {
  const parts = [
    `Selling at ${money(b.salePriceCents)} with ${(i.sellingCostBps / 100).toFixed(2)}% selling costs, ${money(b.prepCostsCents)} of preparation and a ${money(b.mortgagePayoffCents)} payoff leaves an estimated ${money(b.netProceedsCents)} in proceeds.`,
    `Buying at ${money(i.newPriceCents)} with ${(i.downPaymentBps / 100).toFixed(1)}% down needs about ${money(b.cashNeededCents)} in cash (down payment, ${(i.buyerClosingCostBps / 100).toFixed(1)}% closing costs and moving).`,
    `At ${(i.rateBps / 100).toFixed(2)}% over ${i.termYears} years, principal and interest is about ${money(b.monthlyPrincipalInterestCents)}/month; with taxes, insurance and HOA the estimated housing payment is ${money(b.monthlyHousingCents)}/month.`,
    b.gapCents > 0 ? `That leaves an estimated shortfall of ${money(b.gapCents)}.` : `That leaves an estimated cushion of ${money(-b.gapCents)}.`,
  ];
  if (!i.sellFirst) parts.push(`Buying first: about ${money(b.bridgeNeededCents)} of bridge financing and ${money(b.overlapCarryingCents + b.bridgeInterestCents)} in carrying costs over ${i.overlapMonths} month(s).`);
  return parts.join(" ");
}

/** Every amount the explanation may mention (used to reject AI text that invents figures). */
export function knownAmounts(result: ReturnType<typeof analyze>, i: DualMoveInput): number[] {
  const all: number[] = [i.homeValueCents, i.newPriceCents, i.savingsCents, i.mortgageBalanceCents];
  const push = (b: Breakdown) => all.push(...Object.values(b));
  push(result.expected);
  result.scenarios.forEach((s) => push(s.result));
  result.priceScenarios.forEach((s) => (all.push(s.newPriceCents), push(s.result)));
  result.downPaymentScenarios.forEach((s) => push(s.result));
  push(result.sellVsBuy.sellFirst);
  push(result.sellVsBuy.buyFirst);
  result.rateSensitivity.forEach((r) => all.push(r.monthlyPrincipalInterestCents));
  result.saleSensitivity.forEach((r) => all.push(r.salePriceCents, r.netProceedsCents));
  return all.map((c) => Math.abs(c));
}

export function agentBriefing(i: DualMoveInput, r: ReturnType<typeof analyze>): string {
  const b = r.expected;
  return [
    "DUAL-MOVE BRIEFING (client-provided assumptions — estimates only)",
    "",
    `Current home: est. ${money(i.homeValueCents)}, mortgage ${money(i.mortgageBalanceCents)}, selling costs ${(i.sellingCostBps / 100).toFixed(2)}%, prep ${money(i.prepCostsCents)}`,
    `Next home: target ${money(i.newPriceCents)}, ${(i.downPaymentBps / 100).toFixed(1)}% down, ${(i.rateBps / 100).toFixed(2)}% / ${i.termYears} yrs`,
    `Plan: ${i.sellFirst ? "sell first" : `buy first (${i.overlapMonths} month overlap)`}, timeline ${i.timelineMonths} months`,
    "",
    `Est. net proceeds: ${money(b.netProceedsCents)}`,
    `Cash needed at purchase: ${money(b.cashNeededCents)} · available: ${money(b.cashAvailableCents)} · ${b.gapCents > 0 ? `shortfall ${money(b.gapCents)}` : `cushion ${money(-b.gapCents)}`}`,
    `Est. housing payment: ${money(b.monthlyHousingCents)}/mo (P&I ${money(b.monthlyPrincipalInterestCents)})`,
    ...(r.gaps.length ? ["", "Flags:", ...r.gaps.map((g) => `- ${g}`)] : []),
    "",
    "Scenarios (cushion / shortfall):",
    ...r.scenarios.map((s) => `- ${s.label}: ${s.result.gapCents > 0 ? `shortfall ${money(s.result.gapCents)}` : `cushion ${money(-s.result.gapCents)}`}, payment ${money(s.result.monthlyHousingCents)}/mo`),
  ].join("\n");
}

export function toCsv(i: DualMoveInput, r: ReturnType<typeof analyze>): string {
  const rows: (string | number)[][] = [["Line", ...r.scenarios.map((s) => s.label)]];
  const line = (label: string, key: keyof Breakdown) => rows.push([label, ...r.scenarios.map((s) => (s.result[key] / 100).toFixed(2))]);
  line("Sale price", "salePriceCents");
  line("Selling costs", "sellingCostsCents");
  line("Preparation", "prepCostsCents");
  line("Mortgage payoff", "mortgagePayoffCents");
  line("Net proceeds", "netProceedsCents");
  line("Down payment", "downPaymentCents");
  line("Buyer closing costs", "buyerClosingCostsCents");
  line("Moving", "movingCostsCents");
  line("Cash needed", "cashNeededCents");
  line("Cash available", "cashAvailableCents");
  line("Shortfall (+) / cushion (-)", "gapCents");
  line("Monthly principal & interest", "monthlyPrincipalInterestCents");
  line("Monthly housing payment", "monthlyHousingCents");
  line("Bridge financing needed", "bridgeNeededCents");
  rows.push([]);
  rows.push(["Assumptions are the user's own. Estimates only — not a loan approval, appraisal, or legal, tax or financial advice."]);
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}
