import { contextFor, requireAdmin } from "@/lib/server/auth";
import { conversionActivity, funnel, insights, journeys, overview, parseRange, propertyEngagement } from "@/lib/server/analytics";
import { handler } from "@/lib/server/http";

/** GET /api/analytics/overview?days=30&classes=production — owner/admin company-level analytics. */
export const GET = handler(async (request: Request) => {
  const viewer = await requireAdmin(request);
  const range = parseRange(new URL(request.url));
  const ctx = contextFor(viewer);
  const [o, f, j, p, c, i] = await Promise.all([overview(ctx, range), funnel(ctx, range), journeys(ctx, range), propertyEngagement(ctx, range), conversionActivity(ctx, range), insights(ctx, range)]);
  return Response.json(
    { range: { from: range.from.toISOString(), to: range.to.toISOString(), classes: range.classes }, overview: o, funnel: f, journeys: j, properties: p, conversions: c, insights: i },
    { headers: { "Cache-Control": "no-store" } },
  );
});
