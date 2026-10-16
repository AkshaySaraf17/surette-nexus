import { describe, expect, it } from "vitest";
import { findCandidates, sniffType } from "@/lib/server/documents";

/** Deal documents: type detection by content and contract value extraction (no AI). */
describe("document intake", () => {
  it("identifies files by content, not extension", () => {
    expect(sniffType(Buffer.from("%PDF-1.7\n..."))).toBe("application/pdf");
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe("image/jpeg");
    expect(sniffType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffType(Buffer.from("Purchase price $450,000"))).toBe("text/plain");
    expect(sniffType(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]))).toBeNull(); // Windows executable
  });
  it("extracts contract candidates with their source text", () => {
    const text = "Effective Date: October 15, 2026. The Purchase Price is $450,000.00. Buyer shall pay an earnest money deposit of $10,000. Buyer has an inspection period of 10 calendar days. Closing shall occur on or before 11/19/2026.";
    const got = Object.fromEntries(findCandidates([{ page: 2, text }]).map((c) => [c.field, c]));
    expect(got.purchase_price.normalized).toBe(45_000_000);
    expect(got.earnest_money.normalized).toBe(1_000_000);
    expect(got.closing_date.normalized).toBe("2026-11-19");
    expect(got.effective_date.normalized).toBe("2026-10-15");
    expect(got.inspection_days.normalized).toBe(10);
    expect(got.purchase_price.source).toMatch(/^page 2:/);
  });
  it("returns nothing rather than guessing", () => {
    expect(findCandidates([{ page: 1, text: "Lovely farmhouse with a red barn." }])).toEqual([]);
  });
});
