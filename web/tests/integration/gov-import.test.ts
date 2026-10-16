import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getPool, withSystemDb } from "@/lib/server/db";
import { importSnapshots, snapshotDir } from "@/lib/server/gov-data";
import { readSeries } from "@/lib/server/market";

afterAll(() => getPool().end());

describe("government data import", () => {
  it("loads every snapshot and the market API serves it with provenance", async () => {
    const counts = await importSnapshots();
    expect(Object.keys(counts).sort()).toEqual(["acs5", "bls_laus", "census_bps", "fhfa_hpi"]);
    for (const n of Object.values(counts)) expect(n).toBeGreaterThan(0);
    const { series } = await readSeries("2015-01-01");
    const waterville = series.find((s) => s.id === "acs:median_home_value:waterville")!;
    expect(waterville.latest?.value).toBeGreaterThan(0);
    expect(waterville.latest?.moe).toBeGreaterThan(0);
    expect(waterville.dataset).toBe("acs5");
    const imports = await withSystemDb((db) => db.query<{ dataset: string }>("SELECT DISTINCT dataset FROM gov_dataset_imports"));
    expect(imports.map((r) => r.dataset).sort()).toEqual(["acs5", "bls_laus", "census_bps", "fhfa_hpi"]);
  });

  it("refuses a snapshot that was edited after download", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gov-"));
    cpSync(snapshotDir(), dir, { recursive: true });
    const file = path.join(dir, "acs5.csv");
    writeFileSync(file, readFileSync(file, "utf8").replace(/184600/, "999999"));
    await expect(importSnapshots(dir)).rejects.toThrow(/checksum mismatch/);
  });
});
