import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gapVerdict, marketLabSchema } from "@/lib/server/market-lab";

/** Market Lab results file (built by ml/market_lab/build.py) and how the site words it. */
describe("Market Lab results", () => {
  const file = path.resolve(process.cwd(), "../data/insights/market_lab.json");
  const lab = marketLabSchema.parse(JSON.parse(readFileSync(file, "utf8")));

  it("the committed results match the schema the page reads", () => {
    expect(lab.towns.map((t) => t.town)).toContain("Waterville");
    expect(lab.price_index.map((p) => p.geo).sort()).toEqual(["kennebec", "maine", "somerset"]);
    for (const p of lab.price_index) for (const x of p.projection) expect(x.low).toBeLessThanOrEqual(x.central), expect(x.central).toBeLessThanOrEqual(x.high);
  });

  it("the chosen model beats the baseline by a wide margin", () => {
    const best = lab.regression.models.find((m) => m.model === lab.regression.best_model)!;
    const baseline = lab.regression.models.find((m) => m.model.startsWith("Baseline"))!;
    expect(best.r2).toBeGreaterThan(0.5);
    expect(best.rmse_log).toBeLessThan(baseline.rmse_log * 0.7);
  });

  it("a town is only called higher or lower when the gap exceeds the model's typical error", () => {
    expect(gapVerdict(-0.13, 0.15)).toBe("in_line");
    expect(gapVerdict(0.15, 0.15)).toBe("in_line");
    expect(gapVerdict(-0.2, 0.15)).toBe("below");
    expect(gapVerdict(0.28, 0.15)).toBe("above");
  });
});
