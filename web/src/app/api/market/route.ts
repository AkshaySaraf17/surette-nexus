import { handler } from "@/lib/server/http";
import { readSeries, refreshIfStale } from "@/lib/server/market";

/**
 * GET /api/market?years=10 — public market data with provenance (source, geography, period,
 * retrieval time, methodology notes). Triggers a background refresh when data is > 24 h old.
 */
export const GET = handler(async (request: Request) => {
  const years = Math.min(Math.max(Number(new URL(request.url).searchParams.get("years") ?? "10") || 10, 1), 25);
  const from = new Date(Date.UTC(new Date().getUTCFullYear() - years, 0, 1)).toISOString().slice(0, 10);
  const data = await readSeries(from);
  refreshIfStale(data.newestFetch ? new Date(data.newestFetch) : null);
  return Response.json(data, { headers: { "Cache-Control": "public, max-age=300, s-maxage=600, stale-while-revalidate=3600" } });
});
