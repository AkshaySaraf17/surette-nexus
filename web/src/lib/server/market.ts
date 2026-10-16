import "server-only";
import { cached, invalidateTags } from "./cache";
import { breaker } from "./circuit-breaker";
import { withSystemDb } from "./db";
import { GOV_SERIES } from "@/lib/gov-data";

/**
 * Market data adapters. Public sources only, every value stored with its provenance.
 *
 *  - FRED (Federal Reserve Bank of St. Louis) public CSV downloads — no key required.
 *    Series originate from Freddie Mac (mortgage rates), FHFA (house price indexes),
 *    the U.S. Census Bureau/HUD (median sales price) and Realtor.com (listing inventory,
 *    median listing price, days on market — Realtor.com data, redistributed by FRED).
 *  - Government datasets downloaded straight from the agencies — Census ACS and Building
 *    Permits, BLS unemployment, FHFA house price indexes — see lib/gov-data.ts. They are
 *    loaded from data/gov/ snapshots and refreshed monthly by the worker. No keys needed.
 *
 * Nothing is synthesized: if a fetch fails, the last stored values are shown with their
 * retrieval time, or the metric is shown as unavailable.
 */

export interface SeriesDef {
  id: string;
  source: "FRED";
  sourceSeriesId: string;
  title: string;
  units: string;
  geography: string;
  geoLevel: "national" | "state" | "county";
  frequency: string;
  originalSource: string;
  notes: string;
  metric: string; // groups series that are comparable across geographies
}

const fred = (id: string, metric: string, title: string, units: string, geography: string, geoLevel: SeriesDef["geoLevel"], frequency: string, originalSource: string, notes: string): SeriesDef => ({
  id: `fred:${id}`,
  source: "FRED",
  sourceSeriesId: id,
  title,
  units,
  geography,
  geoLevel,
  frequency,
  originalSource,
  notes,
  metric,
});

export const SERIES: SeriesDef[] = [
  fred("MORTGAGE30US", "mortgage_rate", "30-year fixed mortgage rate", "percent", "United States", "national", "weekly", "Freddie Mac Primary Mortgage Market Survey", "National average for conforming loans; individual quotes vary by credit, points and lender."),
  fred("MSPUS", "median_sale_price_us", "Median sales price of houses sold", "dollars", "United States", "national", "quarterly", "U.S. Census Bureau & HUD", "New and existing single-family houses sold, national only. Not seasonally adjusted."),
  fred("USSTHPI", "hpi", "House Price Index (all transactions)", "index (1980 Q1 = 100)", "United States", "national", "quarterly", "Federal Housing Finance Agency", "Repeat-sales index; measures change over time, not price levels."),
  fred("MESTHPI", "hpi", "House Price Index (all transactions)", "index (1980 Q1 = 100)", "Maine", "state", "quarterly", "Federal Housing Finance Agency", "Repeat-sales index; measures change over time, not price levels."),
  fred("ATNHPIUS23011A", "hpi_county_annual", "House Price Index (all transactions, annual)", "index (2000 = 100)", "Kennebec County, ME", "county", "annual", "Federal Housing Finance Agency", "Annual county index (developmental series); small samples can be volatile."),
  fred("MEDLISPRIUS", "median_list_price", "Median listing price", "dollars", "United States", "national", "monthly", "Realtor.com (via FRED)", "Asking prices of active listings, not sale prices."),
  fred("MEDLISPRIME", "median_list_price", "Median listing price", "dollars", "Maine", "state", "monthly", "Realtor.com (via FRED)", "Asking prices of active listings, not sale prices."),
  fred("MEDLISPRI23011", "median_list_price", "Median listing price", "dollars", "Kennebec County, ME", "county", "monthly", "Realtor.com (via FRED)", "Asking prices of active listings, not sale prices. County samples are small."),
  fred("ACTLISCOUUS", "active_listings", "Active listing count", "listings", "United States", "national", "monthly", "Realtor.com (via FRED)", "Listings on Realtor.com, which may differ from MLS counts."),
  fred("ACTLISCOUME", "active_listings", "Active listing count", "listings", "Maine", "state", "monthly", "Realtor.com (via FRED)", "Listings on Realtor.com, which may differ from MLS counts."),
  fred("ACTLISCOU23011", "active_listings", "Active listing count", "listings", "Kennebec County, ME", "county", "monthly", "Realtor.com (via FRED)", "Listings on Realtor.com, which may differ from MLS counts."),
  fred("NEWLISCOUME", "new_listings", "New listing count", "listings", "Maine", "state", "monthly", "Realtor.com (via FRED)", "Listings newly added during the month."),
  fred("NEWLISCOU23011", "new_listings", "New listing count", "listings", "Kennebec County, ME", "county", "monthly", "Realtor.com (via FRED)", "Listings newly added during the month."),
  fred("PENLISCOUME", "pending_listings", "Pending listing count", "listings", "Maine", "state", "monthly", "Realtor.com (via FRED)", "Listings under contract but not yet closed."),
  fred("MEDDAYONMARUS", "days_on_market", "Median days on market", "days", "United States", "national", "monthly", "Realtor.com (via FRED)", "For active listings; closed-sale days on market may differ."),
  fred("MEDDAYONMARME", "days_on_market", "Median days on market", "days", "Maine", "state", "monthly", "Realtor.com (via FRED)", "For active listings; closed-sale days on market may differ."),
  fred("MEDDAYONMAR23011", "days_on_market", "Median days on market", "days", "Kennebec County, ME", "county", "monthly", "Realtor.com (via FRED)", "For active listings; closed-sale days on market may differ."),
];

export function sourceUrl(s: SeriesDef): string {
  return `https://fred.stlouisfed.org/series/${s.sourceSeriesId}`;
}

async function fetchFred(s: SeriesDef): Promise<{ period: string; value: number }[]> {
  const res = await breaker("fred", { failureThreshold: 5, resetAfterMs: 5 * 60_000, timeoutMs: 20_000 }).exec((signal) =>
    fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(s.sourceSeriesId)}`, { signal, redirect: "follow", cache: "no-store" }),
  );
  if (!res.ok) throw new Error(`FRED returned ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  if (!/^observation_date,/i.test(lines[0] ?? "")) throw new Error("Unexpected FRED response format");
  const out: { period: string; value: number }[] = [];
  for (const line of lines.slice(1)) {
    const [date, raw] = line.split(",");
    const value = Number(raw);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && raw !== "." && raw !== "" && Number.isFinite(value)) out.push({ period: date, value });
  }
  if (!out.length) throw new Error("No observations in FRED response");
  return out;
}

/** Fetch one series and upsert its observations. Records the error (and keeps old data) on failure. */
export async function refreshSeries(s: SeriesDef): Promise<{ id: string; ok: boolean; count: number; error?: string }> {
  await withSystemDb((db) =>
    db.query(
      `INSERT INTO market_series (id, source, source_series_id, title, units, geography, geo_level, frequency, source_url, original_source, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, units = EXCLUDED.units, notes = EXCLUDED.notes, source_url = EXCLUDED.source_url`,
      [s.id, s.source, s.sourceSeriesId, s.title, s.units, s.geography, s.geoLevel, s.frequency, sourceUrl(s), s.originalSource, s.notes],
    ),
  );
  try {
    const rows = await fetchFred(s);
    const recent = rows.filter((r) => r.period >= "2000-01-01");
    const retrievedAt = new Date();
    await withSystemDb(async (db) => {
      for (let i = 0; i < recent.length; i += 500) {
        const chunk = recent.slice(i, i + 500);
        const values = chunk.flatMap((r) => [s.id, r.period, r.value, retrievedAt]);
        const placeholders = chunk.map((_, k) => `($${k * 4 + 1}, $${k * 4 + 2}, $${k * 4 + 3}, $${k * 4 + 4})`).join(",");
        await db.query(
          `INSERT INTO market_observations (series_id, period, value, retrieved_at) VALUES ${placeholders}
           ON CONFLICT (series_id, period) DO UPDATE SET value = EXCLUDED.value, retrieved_at = EXCLUDED.retrieved_at`,
          values,
        );
      }
      await db.query("UPDATE market_series SET last_fetched_at = $2, last_error = NULL WHERE id = $1", [s.id, retrievedAt]);
    });
    return { id: s.id, ok: true, count: recent.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withSystemDb((db) => db.query("UPDATE market_series SET last_error = $2 WHERE id = $1", [s.id, message.slice(0, 300)]));
    return { id: s.id, ok: false, count: 0, error: message };
  }
}

export async function refreshAll() {
  const results = [];
  for (const s of SERIES) results.push(await refreshSeries(s)); // sequential: polite to public servers
  await invalidateTags(["market"]);
  return results;
}

let refreshing: Promise<unknown> | null = null;
/** Refresh in the background when the newest fetch is older than 24 hours. */
export function refreshIfStale(lastFetched: Date | null) {
  if (refreshing) return;
  if (lastFetched && Date.now() - lastFetched.getTime() < 24 * 3_600_000) return;
  refreshing = refreshAll().finally(() => {
    refreshing = null;
  });
}

export interface SeriesPayload {
  id: string;
  metric: string;
  title: string;
  units: string;
  geography: string;
  geoLevel: string;
  frequency: string;
  source: string;
  originalSource: string;
  sourceUrl: string;
  notes: string;
  lastFetchedAt: string | null;
  lastError: string | null;
  dataset: string | null;
  latest: { period: string; value: number; moe: number | null } | null;
  /** Latest period is older than expected for its frequency. */
  stale: boolean;
  observations: { period: string; value: number; moe: number | null }[];
}

// Monthly sources publish with a lag (BLS ~4–8 weeks after the month ends).
const MAX_AGE_DAYS: Record<string, number> = { weekly: 21, monthly: 100, quarterly: 200, annual: 800, "annual (5-year estimate)": 1100 };

export function readSeries(fromIso: string): Promise<{ series: SeriesPayload[]; newestFetch: string | null }> {
  return cached(`market:${fromIso}`, { ttlMs: 10 * 60_000, tags: ["market"] }, () => querySeries(fromIso));
}

async function querySeries(fromIso: string): Promise<{ series: SeriesPayload[]; newestFetch: string | null }> {
  const { meta, obs } = await withSystemDb(async (db) => {
    const meta = await db.query<{ id: string; last_fetched_at: Date | null; last_error: string | null }>("SELECT id, last_fetched_at, last_error FROM market_series");
    // Gov series with sparse vintages (ACS) keep their latest point even if it's older than the range.
    const obs = await db.query<{ series_id: string; period: string; value: number; moe: number | null }>(
      `SELECT series_id, period, value, moe FROM market_observations
        WHERE period >= $1 OR series_id LIKE 'acs:%'
        ORDER BY series_id, period`,
      [fromIso],
    );
    return { meta, obs };
  });
  const byId = new Map(meta.map((m) => [m.id, m]));
  const grouped = new Map<string, { period: string; value: number; moe: number | null }[]>();
  for (const o of obs) (grouped.get(o.series_id) ?? grouped.set(o.series_id, []).get(o.series_id)!).push({ period: o.period, value: Number(o.value), moe: o.moe === null ? null : Number(o.moe) });
  const defs = [
    ...SERIES.map((s) => ({ ...s, sourceUrl: sourceUrl(s), dataset: null as string | null })),
    ...GOV_SERIES.map((g) => ({ id: g.id, metric: g.metric, title: g.title, units: g.units, geography: g.geography, geoLevel: g.geoLevel, frequency: g.frequency, source: g.source, originalSource: g.originalSource, sourceUrl: g.sourceUrl, notes: g.notes, dataset: g.dataset as string | null })),
  ];
  const newest = meta.reduce<Date | null>((a, m) => (m.last_fetched_at && (!a || m.last_fetched_at > a) ? m.last_fetched_at : a), null);
  return {
    newestFetch: newest?.toISOString() ?? null,
    series: defs.map((s) => {
      const m = byId.get(s.id);
      const observations = grouped.get(s.id) ?? [];
      const latest = observations[observations.length - 1] ?? null;
      const ageDays = latest ? (Date.now() - new Date(`${latest.period}T00:00:00Z`).getTime()) / 86_400_000 : Infinity;
      return {
        id: s.id,
        metric: s.metric,
        title: s.title,
        units: s.units,
        geography: s.geography,
        geoLevel: s.geoLevel,
        frequency: s.frequency,
        source: s.source,
        originalSource: s.originalSource,
        sourceUrl: s.sourceUrl,
        notes: s.notes,
        dataset: s.dataset,
        lastFetchedAt: m?.last_fetched_at?.toISOString() ?? null,
        lastError: m?.last_error ?? null,
        latest,
        stale: latest ? ageDays > (MAX_AGE_DAYS[s.frequency] ?? 400) : false,
        observations,
      };
    }),
  };
}
