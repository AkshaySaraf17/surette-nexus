import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export { gapVerdict, type GapVerdict } from "@/lib/market-lab-verdict";

/**
 * Market Lab results: models trained offline by ml/market_lab/build.py on public data (Census ACS for
 * all Maine towns, FHFA price index) and written to data/insights/market_lab.json. The web app only
 * reads and validates the file; it never trains anything at request time.
 */

const similar = z.object({ town: z.string(), county: z.string(), distance: z.number(), median_home_value: z.number(), median_household_income: z.number().nullable() });
const point = z.object({ year: z.number(), value: z.number() });
const projection = z.object({ year: z.number(), central: z.number(), low: z.number(), high: z.number() });

export const marketLabSchema = z.object({
  generated_at: z.string(),
  cleaning: z.record(z.string(), z.number()),
  regression: z.object({
    best_model: z.string(),
    typical_error_pct: z.number(),
    models: z.array(z.object({ model: z.string(), r2: z.number(), median_abs_pct_error: z.number(), rmse_log: z.number() })),
    importance: z.array(z.object({ feature: z.string(), importance: z.number() })),
  }),
  classification: z.object({ threshold_dollars: z.number(), models: z.array(z.object({ model: z.string(), roc_auc: z.number(), accuracy: z.number() })) }),
  clusters: z.object({ k: z.number(), silhouette: z.number(), names: z.record(z.string(), z.string()), sizes: z.record(z.string(), z.number()) }),
  towns: z.array(
    z.object({
      town: z.string(),
      county: z.string(),
      group: z.string(),
      similar: z.array(similar),
      median_home_value: z.number(),
      median_home_value_moe: z.number(),
      expected_home_value: z.number().optional(),
      gap_pct: z.number().optional(),
    }),
  ),
  price_index: z.array(z.object({ geo: z.string(), model: z.string(), history: z.array(point), projection: z.array(projection), backtest_mape: z.record(z.string(), z.number()) })),
});

export type MarketLab = z.infer<typeof marketLabSchema>;

function insightsDir() {
  return process.env.INSIGHTS_DIR ?? path.resolve(/*turbopackIgnore: true*/ process.cwd(), "../data/insights");
}

let cache: { at: number; value: MarketLab | null } | null = null;

/** The latest Market Lab results, or null if they haven't been built (the page then hides the section). */
export async function getMarketLab(): Promise<MarketLab | null> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.value;
  let value: MarketLab | null = null;
  try {
    value = marketLabSchema.parse(JSON.parse(await readFile(path.join(insightsDir(), "market_lab.json"), "utf8")));
  } catch (error) {
    console.warn("[market-lab] results unavailable:", error instanceof Error ? error.message : error);
  }
  cache = { at: Date.now(), value };
  return value;
}
