import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES, commissionCents, daysBetween, dueDate, dueFromRule, parseDate, resolveTemplate, stageRequirements, urgency } from "@/lib/deal-rules";

describe("deal deadlines are deterministic", () => {
  it("adds calendar days and rolls weekends forward", () => {
    // 2026-10-15 is a Thursday.
    expect(dueDate("2026-10-15", 10)).toBe("2026-10-25"); // Sunday, no roll
    expect(dueDate("2026-10-15", 10, true)).toBe("2026-10-26"); // → Monday
    expect(dueDate("2026-10-15", 9, true)).toBe("2026-10-26"); // Saturday → Monday
    expect(dueDate("2026-11-19", -5)).toBe("2026-11-14");
    expect(dueDate("2026-12-28", 7)).toBe("2027-01-04"); // year boundary
  });

  it("rejects impossible dates", () => {
    expect(() => parseDate("2026-02-30")).toThrow();
    expect(() => parseDate("10/15/2026")).toThrow();
  });

  it("templates resolve only once their anchor date exists", () => {
    const items = DEFAULT_TEMPLATES.buyer.items;
    const none = resolveTemplate(items, { contractDate: null, closingDate: null });
    expect(none.every((i) => i.dueOn === null)).toBe(true);
    const some = resolveTemplate(items, { contractDate: "2026-10-15", closingDate: "2026-11-19" });
    expect(some.every((i) => typeof i.dueOn === "string")).toBe(true);
    for (const item of some) expect(dueFromRule(item.rule, { contractDate: "2026-10-15", closingDate: "2026-11-19" })).toBe(item.dueOn);
  });

  it("manual items (no rule) are left alone on recompute", () => {
    expect(dueFromRule(null, { contractDate: "2026-10-15", closingDate: null })).toBeUndefined();
    expect(dueFromRule("closing-3", { contractDate: "2026-10-15", closingDate: null })).toBeNull();
  });

  it("classifies urgency", () => {
    expect(urgency("2026-10-14", false, "2026-10-15")).toBe("overdue");
    expect(urgency("2026-10-17", false, "2026-10-15")).toBe("due_soon");
    expect(urgency("2026-10-30", false, "2026-10-15")).toBe("upcoming");
    expect(urgency(null, false, "2026-10-15")).toBe("no_date");
    expect(urgency("2026-10-01", true, "2026-10-15")).toBe("done");
    expect(daysBetween("2026-10-15", "2026-11-19")).toBe(35);
  });
});

describe("stage gates", () => {
  it("under contract needs a contract date and price", () => {
    expect(Object.keys(stageRequirements("under_contract", { contractDate: null, closingDate: null, priceCents: null }))).toEqual(["contractDate", "priceCents"]);
    expect(stageRequirements("under_contract", { contractDate: "2026-10-15", closingDate: null, priceCents: 1 })).toEqual({});
  });
  it("closing needs a closing date; lost needs a reason", () => {
    expect(stageRequirements("closed", { contractDate: "2026-10-15", closingDate: null, priceCents: 1 })).toHaveProperty("closingDate");
    expect(stageRequirements("lost", { contractDate: null, closingDate: null, priceCents: null, lostReason: "  " })).toHaveProperty("lostReason");
    expect(stageRequirements("prospect", { contractDate: null, closingDate: null, priceCents: null })).toEqual({});
  });
});

describe("commission", () => {
  it("is integer cents, rounded half-up", () => {
    expect(commissionCents(45_000_000, 250)).toBe(1_125_000);
    expect(commissionCents(3, 5000)).toBe(2);
    expect(commissionCents(null, 250)).toBeNull();
    expect(() => commissionCents(100.5, 250)).toThrow();
  });
});
