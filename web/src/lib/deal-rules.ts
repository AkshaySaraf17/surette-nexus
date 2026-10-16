/**
 * Deterministic deal rules: stages, checklist templates, deadline arithmetic and
 * commission math. No AI is involved in any of this.
 *
 * IMPORTANT: templates are configurable workflow aids, not legal requirements.
 * Deadlines in a real Maine purchase & sale agreement are whatever that contract
 * says; agents set the key dates and can edit any milestone.
 */

export const DEAL_STAGES = ["prospect", "showing", "offer", "under_contract", "inspection", "appraisal", "clear_to_close", "closed", "lost"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];
export type DealSide = "buyer" | "seller" | "dual" | "lease";

export const STAGE_LABEL: Record<DealStage, string> = {
  prospect: "Prospect",
  showing: "Showings",
  offer: "Offer",
  under_contract: "Under contract",
  inspection: "Inspection",
  appraisal: "Appraisal & financing",
  clear_to_close: "Clear to close",
  closed: "Closed",
  lost: "Lost",
};

/** Requirements to enter a stage. Returns a field → message map (empty when allowed). */
export function stageRequirements(stage: DealStage, deal: { contractDate: string | null; closingDate: string | null; lostReason?: string | null; priceCents: number | null }): Record<string, string> {
  const errors: Record<string, string> = {};
  const contractStages: DealStage[] = ["under_contract", "inspection", "appraisal", "clear_to_close", "closed"];
  if (contractStages.includes(stage) && !deal.contractDate) errors.contractDate = "Add the contract (effective) date first.";
  if (contractStages.includes(stage) && !deal.priceCents) errors.priceCents = "Add the contract price first.";
  if ((stage === "clear_to_close" || stage === "closed") && !deal.closingDate) errors.closingDate = "Add the closing date first.";
  if (stage === "lost" && !deal.lostReason?.trim()) errors.lostReason = "Say briefly why the deal was lost.";
  return errors;
}

export interface TemplateItem {
  label: string;
  anchor: "contract" | "closing";
  offsetDays: number;
  milestone: boolean;
  clientVisible: boolean;
  /** If the computed date falls on a weekend, move it to the next Monday. */
  rollWeekend?: boolean;
}

export const DEFAULT_TEMPLATES: Record<DealSide, { name: string; items: TemplateItem[] }> = {
  buyer: {
    name: "Buyer purchase (typical)",
    items: [
      { label: "Earnest money deposited", anchor: "contract", offsetDays: 3, milestone: true, clientVisible: true, rollWeekend: true },
      { label: "Schedule home inspection", anchor: "contract", offsetDays: 2, milestone: false, clientVisible: false },
      { label: "Inspection period ends", anchor: "contract", offsetDays: 10, milestone: true, clientVisible: true },
      { label: "Submit loan application documents", anchor: "contract", offsetDays: 5, milestone: false, clientVisible: false },
      { label: "Appraisal completed", anchor: "contract", offsetDays: 21, milestone: true, clientVisible: true },
      { label: "Financing commitment due", anchor: "contract", offsetDays: 30, milestone: true, clientVisible: true, rollWeekend: true },
      { label: "Order title search", anchor: "contract", offsetDays: 7, milestone: false, clientVisible: false },
      { label: "Confirm homeowners insurance", anchor: "closing", offsetDays: -10, milestone: false, clientVisible: true },
      { label: "Final walk-through", anchor: "closing", offsetDays: -1, milestone: true, clientVisible: true },
      { label: "Closing", anchor: "closing", offsetDays: 0, milestone: true, clientVisible: true },
    ],
  },
  seller: {
    name: "Seller listing to close (typical)",
    items: [
      { label: "Seller disclosures delivered", anchor: "contract", offsetDays: 2, milestone: true, clientVisible: true },
      { label: "Confirm earnest money received", anchor: "contract", offsetDays: 4, milestone: false, clientVisible: false, rollWeekend: true },
      { label: "Inspection response window", anchor: "contract", offsetDays: 12, milestone: true, clientVisible: true },
      { label: "Appraisal access arranged", anchor: "contract", offsetDays: 14, milestone: false, clientVisible: false },
      { label: "Buyer financing commitment", anchor: "contract", offsetDays: 30, milestone: true, clientVisible: true, rollWeekend: true },
      { label: "Order payoff statement", anchor: "closing", offsetDays: -14, milestone: false, clientVisible: false },
      { label: "Utilities transfer scheduled", anchor: "closing", offsetDays: -5, milestone: false, clientVisible: true },
      { label: "Closing", anchor: "closing", offsetDays: 0, milestone: true, clientVisible: true },
    ],
  },
  dual: {
    name: "Dual agency (typical)",
    items: [
      { label: "Dual agency disclosure signed by both parties", anchor: "contract", offsetDays: 0, milestone: true, clientVisible: true },
      { label: "Inspection period ends", anchor: "contract", offsetDays: 10, milestone: true, clientVisible: true },
      { label: "Financing commitment due", anchor: "contract", offsetDays: 30, milestone: true, clientVisible: true, rollWeekend: true },
      { label: "Final walk-through", anchor: "closing", offsetDays: -1, milestone: true, clientVisible: true },
      { label: "Closing", anchor: "closing", offsetDays: 0, milestone: true, clientVisible: true },
    ],
  },
  lease: {
    name: "Lease (typical)",
    items: [
      { label: "Rental application received", anchor: "contract", offsetDays: 0, milestone: true, clientVisible: true },
      { label: "Screening complete", anchor: "contract", offsetDays: 3, milestone: false, clientVisible: false },
      { label: "Security deposit received", anchor: "closing", offsetDays: -3, milestone: true, clientVisible: true },
      { label: "Move-in inspection", anchor: "closing", offsetDays: 0, milestone: true, clientVisible: true },
    ],
  },
};

const DAY_MS = 86_400_000;

/** Parse "YYYY-MM-DD" as a UTC calendar date. */
export function parseDate(iso: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Invalid date ${iso}`);
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) throw new Error(`Invalid date ${iso}`);
  return d;
}

export const formatDate = (d: Date) => d.toISOString().slice(0, 10);

/** anchor + offset calendar days; optionally rolled forward off a weekend. */
export function dueDate(anchorIso: string, offsetDays: number, rollWeekend = false): string {
  const d = new Date(parseDate(anchorIso).getTime() + offsetDays * DAY_MS);
  if (rollWeekend) {
    const day = d.getUTCDay();
    if (day === 6) d.setUTCDate(d.getUTCDate() + 2);
    if (day === 0) d.setUTCDate(d.getUTCDate() + 1);
  }
  return formatDate(d);
}

/** Resolve every template item to a due date given the deal's key dates (null when its anchor isn't set yet). */
export function resolveTemplate(items: TemplateItem[], dates: { contractDate: string | null; closingDate: string | null }) {
  return items.map((item, index) => {
    const anchor = item.anchor === "contract" ? dates.contractDate : dates.closingDate;
    return {
      ...item,
      sortOrder: index,
      dueOn: anchor ? dueDate(anchor, item.offsetDays, item.rollWeekend) : null,
      rule: `${item.anchor}${item.offsetDays >= 0 ? "+" : ""}${item.offsetDays}${item.rollWeekend ? ":roll" : ""}`,
    };
  });
}

/** Re-derive a due date from a stored rule string ("contract+10:roll"). */
export function dueFromRule(rule: string | null, dates: { contractDate: string | null; closingDate: string | null }): string | null | undefined {
  if (!rule) return undefined; // manual — leave unchanged
  const m = /^(contract|closing)([+-]\d+)(:roll)?$/.exec(rule);
  if (!m) return undefined;
  const anchor = m[1] === "contract" ? dates.contractDate : dates.closingDate;
  return anchor ? dueDate(anchor, Number(m[2]), Boolean(m[3])) : null;
}

export type Urgency = "overdue" | "due_soon" | "upcoming" | "no_date" | "done";

/** Classify a deadline relative to `today` (UTC calendar date). */
export function urgency(dueOn: string | null, done: boolean, today: string, soonDays = 3): Urgency {
  if (done) return "done";
  if (!dueOn) return "no_date";
  const diff = Math.round((parseDate(dueOn).getTime() - parseDate(today).getTime()) / DAY_MS);
  if (diff < 0) return "overdue";
  if (diff <= soonDays) return "due_soon";
  return "upcoming";
}

/** Gross commission in integer cents: price × bps / 10 000, rounded half-up. */
export function commissionCents(priceCents: number | null, bps: number | null): number | null {
  if (priceCents === null || bps === null) return null;
  if (!Number.isSafeInteger(priceCents) || !Number.isInteger(bps) || priceCents < 0 || bps < 0) throw new Error("Invalid commission inputs");
  return Math.floor((priceCents * bps + 5_000) / 10_000);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parseDate(toIso).getTime() - parseDate(fromIso).getTime()) / DAY_MS);
}
