import { describe, expect, it } from "vitest";
import { accumulate, describeCriteria, explainMatch, parseIntent } from "@/lib/server/assistant";
import type { ListingCard } from "@/lib/types";

const cities = ["Oakland", "Waterville", "Winslow"];

describe("AI assistant criteria extraction (deterministic)", () => {
  it("reads the master-prompt example request", () => {
    const i = parseIntent("I am looking for a three-bedroom house in Central Maine, preferably below $350,000, with a garage and a reasonable commute.", cities);
    expect(i.criteria.minBeds).toBe(3);
    expect(i.criteria.maxPriceCents).toBe(35_000_000);
    expect(i.criteria.minGarage).toBe(1);
    expect(i.isSearch).toBe(true);
  });
  it("reads town, budget shorthand, baths, acreage, square feet and showing wishes", () => {
    const i = parseIntent("4 bed 2.5 bath lake house in Oakland under 2m on 2 acres, 3,000 sq ft — can I tour it Saturday?", cities);
    expect(i.criteria).toMatchObject({ city: "Oakland", minBeds: 4, minBaths: 2.5, maxPriceCents: 200_000_000, minLotSqft: 87_120, minSqft: 3000 });
    expect(i.criteria.features).toContain("lake");
    expect(i.wantsShowing).toBe(true);
  });
  it("handles rentals without inflating monthly amounts", () => {
    const i = parseIntent("2br rental in Waterville below $2,500 per month", cities);
    expect(i.criteria.type).toBe("rent");
    expect(i.criteria.maxPriceCents).toBe(250_000);
  });
  it("recognizes camps, cabins and outdoor living as home styles", () => {
    expect(parseIntent("a camp on the lake under 300k", cities).criteria.style).toBe("camps-cottages");
    expect(parseIntent("looking for a cottage for summers", cities).criteria.style).toBe("camps-cottages");
    expect(parseIntent("a cabin in the woods", cities).criteria.style).toBe("cabin-woods");
    expect(parseIntent("house with a big backyard and a fire pit", cities).criteria.style).toBe("outdoor-oasis");
    expect(parseIntent("a camp", cities).isSearch).toBe(true);
    expect(describeCriteria(parseIntent("a camp", cities).criteria)).toContain("camps & cottages");
  });
  it("reads a commute limit in minutes", () => {
    const c = parseIntent("3 bed home within 20 minutes of Augusta", cities).criteria;
    expect(c).toMatchObject({ commuteTo: "augusta", commuteMinutes: 20 });
    expect(describeCriteria(c).join(" ")).toContain("within 20 min");
    // Without a number the default is 30 minutes.
    expect(parseIntent("short commute to Augusta", cities).criteria.commuteMinutes).toBeUndefined();
  });
  it("spots requests for homes that aren't listed yet", () => {
    for (const q of ["any off-market homes?", "I'm looking for a home that isn't listed yet", "pocket listings on Long Pond"]) {
      expect(parseIntent(q, cities).wantsOffMarket).toBe(true);
    }
    expect(parseIntent("homes for sale in Oakland", cities).wantsOffMarket).toBe(false);
  });
  it("treats short numbers as thousands", () => {
    expect(parseIntent("homes under 450", cities).criteria.maxPriceCents).toBe(45_000_000);
  });
  it("detects market, dual-move, agent and deal questions", () => {
    expect(parseIntent("what are mortgage rates right now?", cities).asksMarket).toBe("rates");
    expect(parseIntent("I need to sell my home and buy another", cities).asksDualMove).toBe(true);
    expect(parseIntent("can an agent call me?", cities).wantsAgent).toBe(true);
    expect(parseIntent("when is my closing date?", cities).asksMyDeal).toBe(true);
  });
  it("flags requests to choose areas by who lives there (fair housing)", () => {
    for (const q of ["a safe neighborhood with families like us", "areas with few immigrants", "what are the demographics of Winslow", "somewhere with no kids"]) {
      expect(parseIntent(q, cities).fairHousingConcern).toBe(true);
    }
    // Property features and accessibility needs are fine.
    expect(parseIntent("wheelchair accessible single-level home with a garage", cities).fairHousingConcern).toBe(false);
  });
  it("accumulates criteria across follow-ups", () => {
    const c = accumulate(
      [
        { role: "user", content: "3 bedrooms in Waterville" },
        { role: "assistant", content: "…" },
        { role: "user", content: "under $500k with a garage" },
      ],
      cities,
    );
    expect(c).toMatchObject({ city: "Waterville", minBeds: 3, maxPriceCents: 50_000_000, minGarage: 1 });
    expect(describeCriteria(c)).toEqual(["in Waterville", "3+ bedrooms", "under $500,000", "1+ car garage"]);
  });
  it("explains matches transparently", () => {
    const l = { city: "Waterville", bedrooms: 4, fullBaths: 2, halfBaths: 1, priceCents: 54_900_000, listingType: "sale", propertyType: "single_family", garageSpaces: 0, livingAreaSqft: 2400, lotSizeSqft: 10_000, latitude: null, longitude: null } as unknown as ListingCard;
    const m = explainMatch(l, { city: "Waterville", minBeds: 3, maxPriceCents: 50_000_000, minGarage: 1, features: [] });
    expect(m.met).toEqual(["in Waterville", "4 bd (wanted 3+)"]);
    expect(m.unmet).toEqual(["$49,000 over budget", "no garage listed"]);
  });
});
