import { describe, expect, it } from "vitest";
import { dollarsToCents, formatCents, formatPrice, formatPriceCompact } from "@/lib/money";
import { COMMUTE_ANCHORS, districtFor, driveRadiusKm, estimateDriveMinutes, walkIndex } from "@/lib/geo";
import { formatBaths } from "@/lib/utils";

describe("money is integer cents", () => {
  it("parses the $410.67 water bill exactly", () => {
    expect(dollarsToCents("410.67")).toBe(41067);
    expect(dollarsToCents("$410.67")).toBe(41067);
    expect(formatCents(41067)).toBe("$410.67");
  });
  it("never goes through floating point", () => {
    // 0.1 + 0.2 style traps: these must be exact.
    expect(dollarsToCents("0.29")).toBe(29);
    expect(dollarsToCents("1,250,000")).toBe(125_000_000);
    expect(dollarsToCents("19.99")! * 3).toBe(5997);
  });
  it("rejects bad input", () => {
    for (const bad of ["", "-5", "1.234", "abc", "1e5", "12..3"]) expect(dollarsToCents(bad)).toBeNull();
  });
  it("formats prices", () => {
    expect(formatPrice(124_500_000)).toBe("$1,245,000");
    expect(formatPriceCompact(189_000_000)).toBe("$1.89M");
    expect(formatPriceCompact(54_900_000)).toBe("$549K");
    expect(formatPriceCompact(100_000_000)).toBe("$1M");
  });
  it("formats baths", () => {
    expect(formatBaths(3, 1)).toBe("3.5");
    expect(formatBaths(2, 0)).toBe("2");
  });
});

describe("local context", () => {
  const mainStreet: [number, number] = [-69.6317, 44.552];
  const rural: [number, number] = [-69.7286, 44.4721];
  it("scores downtown as walkable and farmland as car-dependent", () => {
    expect(walkIndex(mainStreet)).toBeGreaterThan(70);
    expect(walkIndex(rural)).toBeLessThan(10);
  });
  it("assigns districts", () => {
    expect(districtFor(mainStreet)?.id).toBe("aos92-waterville");
    expect(districtFor([-69.7372, 44.5532])?.id).toBe("rsu18");
  });
  it("estimates commutes and their inverse consistently", () => {
    const augusta = COMMUTE_ANCHORS.find((a) => a.id === "augusta")!.position;
    const minutes = estimateDriveMinutes(mainStreet, augusta);
    expect(minutes).toBeGreaterThan(25);
    expect(minutes).toBeLessThan(45);
    for (const m of [10, 20, 30, 45]) expect(driveRadiusKm(m)).toBeGreaterThan(driveRadiusKm(m - 5));
  });
});
