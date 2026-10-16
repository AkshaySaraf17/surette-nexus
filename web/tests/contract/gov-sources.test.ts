import { describe, expect, it } from "vitest";
import { GOV_GEOS } from "@/lib/gov-data";
import { downloadAcs, downloadBps, downloadFhfa, downloadLaus } from "@/lib/server/gov-download";

/**
 * Contract tests against the live agency sources: do their files still have the shape our
 * parsers expect? Network-dependent, so opt-in: RUN_NETWORK_TESTS=1 npm run test:contract
 * (CI runs them weekly so a format change is caught before the monthly refresh).
 */
const live = process.env.RUN_NETWORK_TESTS === "1" ? describe : describe.skip;

live("government sources (live)", () => {
  it("Census ACS summary files contain every geography we report on", async () => {
    const r = await downloadAcs();
    for (const g of GOV_GEOS) expect(r.observations.some((o) => o.seriesId === `acs:median_home_value:${g.key}`), g.key).toBe(true);
  }, 180_000);
  it("BLS LAUS returns monthly rates for all four series", async () => {
    const r = await downloadLaus();
    for (const k of ["kennebec", "somerset", "maine", "us"]) expect(r.observations.filter((o) => o.seriesId.endsWith(`:${k}`)).length, k).toBeGreaterThan(60);
  }, 60_000);
  it("Census Building Permits files parse for counties and the state", async () => {
    const r = await downloadBps(new Date(), 3);
    for (const k of ["kennebec", "somerset", "maine"]) expect(r.observations.some((o) => o.seriesId.endsWith(`:${k}`)), k).toBe(true);
  }, 120_000);
  it("FHFA workbooks parse for counties and the state", async () => {
    const r = await downloadFhfa();
    for (const k of ["kennebec", "somerset", "maine"]) expect(r.observations.filter((o) => o.seriesId.endsWith(`:${k}`)).length, k).toBeGreaterThan(20);
  }, 120_000);
});
