import { connection } from "next/server";
import { handler, notFound } from "@/lib/server/http";
import { getMarketLab } from "@/lib/server/market-lab";

/**
 * GET /api/market/lab — Market Lab results (similar towns, value vs fundamentals, price-index outlook,
 * model evaluation). Trained offline on public data by ml/market_lab/build.py.
 */
export const GET = handler(async () => {
  await connection();
  const lab = await getMarketLab();
  if (!lab) throw notFound("Market Lab results");
  return Response.json(lab, { headers: { "Cache-Control": "public, max-age=300, s-maxage=600" } });
});
