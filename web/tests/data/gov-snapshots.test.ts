import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GOV_GEOS, GOV_SERIES } from "@/lib/gov-data";
import { parseCsv, toCsv, type Manifest } from "@/lib/server/gov-data";

/**
 * Data-quality checks on the government snapshots in data/gov/: integrity (checksums),
 * completeness (every defined series has data), and plausibility (values in sane ranges).
 * These catch a broken download or a format change before it reaches a dashboard.
 */
const dir = path.resolve(__dirname, "../../../data/gov");
const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;
const all = Object.values(manifest.datasets).flatMap((d) => parseCsv(readFileSync(path.join(dir, d.file), "utf8")));
const byId = new Map<string, { period: string; value: number; moe: number | null }[]>();
for (const o of all) (byId.get(o.seriesId) ?? byId.set(o.seriesId, []).get(o.seriesId)!).push(o);

describe("integrity", () => {
  it("every snapshot matches the checksum in the manifest", () => {
    for (const d of Object.values(manifest.datasets)) {
      const sha = createHash("sha256").update(readFileSync(path.join(dir, d.file), "utf8")).digest("hex");
      expect(sha, d.file).toBe(d.fileSha256);
    }
  });
  it("records where every file came from — government domains only", () => {
    for (const d of Object.values(manifest.datasets)) {
      expect(d.files.length).toBeGreaterThan(0);
      for (const f of d.files) {
        expect(new URL(f.url.split(" ")[0]).hostname).toMatch(/(\.|^)(census\.gov|bls\.gov|fhfa\.gov)$/);
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });
  it("CSV round-trips exactly", () => {
    const sample = all.slice(0, 50);
    expect(parseCsv(toCsv(sample))).toEqual(sample);
  });
});

describe("completeness", () => {
  it("every defined series has data, and every row belongs to a defined series", () => {
    const defined = new Set(GOV_SERIES.map((s) => s.id));
    for (const id of defined) expect(byId.get(id)?.length ?? 0, id).toBeGreaterThan(0);
    for (const id of byId.keys()) expect(defined.has(id), id).toBe(true);
  });
  it("the community profile covers every geography with all five ACS measures", () => {
    for (const g of GOV_GEOS) for (const m of ["population", "median_household_income", "median_home_value", "median_gross_rent", "homeownership_rate"]) {
      expect(byId.get(`acs:${m}:${g.key}`), `${m} ${g.key}`).toBeTruthy();
    }
  });
  it("monthly unemployment has no gaps except months BLS itself never published", () => {
    // October 2025 was not collected because of the federal government shutdown (BLS footnote "X").
    // It must stay missing — never interpolated.
    const KNOWN_GAPS = new Set(["2025-10-01"]);
    for (const key of ["kennebec", "somerset", "maine", "us"]) {
      const months = byId.get(`bls:unemployment_rate:${key}`)!.map((o) => o.period);
      for (const gap of KNOWN_GAPS) expect(months, `${key} ${gap}`).not.toContain(gap);
      for (let i = 1; i < months.length; i++) {
        const [y0, m0] = months[i - 1].split("-").map(Number);
        const [y1, m1] = months[i].split("-").map(Number);
        const step = (y1 - y0) * 12 + (m1 - m0);
        const skipped = Array.from({ length: step - 1 }, (_, k) => {
          const d = new Date(Date.UTC(y0, m0 - 1 + k + 1, 1));
          return d.toISOString().slice(0, 10);
        });
        expect(skipped.every((m) => KNOWN_GAPS.has(m)), `${key}: unexpected gap before ${months[i]}`).toBe(true);
      }
    }
  });
});

describe("plausibility", () => {
  const values = (prefix: string) => all.filter((o) => o.seriesId.startsWith(prefix));
  it("rates are percentages, money and counts are positive", () => {
    for (const o of values("bls:unemployment_rate")) {
      expect(o.value).toBeGreaterThan(0);
      expect(o.value).toBeLessThan(30);
    }
    for (const o of values("acs:homeownership_rate")) {
      expect(o.value).toBeGreaterThan(20);
      expect(o.value).toBeLessThan(100);
    }
    for (const o of values("acs:median_home_value")) {
      expect(o.value).toBeGreaterThan(50_000);
      expect(o.value).toBeLessThan(2_000_000);
    }
    for (const o of values("acs:median_gross_rent")) {
      expect(o.value).toBeGreaterThan(300);
      expect(o.value).toBeLessThan(5_000);
    }
    for (const o of values("bps:units_authorized")) expect(o.value).toBeGreaterThanOrEqual(0);
    for (const o of values("fhfa:hpi_annual")) expect(o.value).toBeGreaterThan(10);
  });
  it("margins of error are smaller than their estimates, and wider for towns than for the state", () => {
    for (const o of values("acs:median_home_value")) if (o.moe !== null) expect(o.moe).toBeLessThan(o.value);
    const town = byId.get("acs:median_home_value:waterville")![0].moe!;
    const state = byId.get("acs:median_home_value:maine")![0].moe!;
    expect(town).toBeGreaterThan(state);
  });
  it("parts are smaller than wholes", () => {
    const pop = (k: string) => byId.get(`acs:population:${k}`)![0].value;
    expect(pop("waterville")).toBeLessThan(pop("kennebec"));
    expect(pop("kennebec")).toBeLessThan(pop("maine"));
    expect(pop("maine")).toBeLessThan(pop("us"));
    const permits = (k: string) => byId.get(`bps:units_authorized:${k}`)!.at(-1)!.value;
    expect(permits("kennebec")).toBeLessThan(permits("maine"));
  });
});
