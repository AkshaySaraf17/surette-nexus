import { requireAdmin } from "@/lib/server/auth";
import { handler } from "@/lib/server/http";
import { enqueueNow } from "@/lib/server/jobs";
import { refreshAll } from "@/lib/server/market";

/**
 * POST /api/market/refresh — owner/admin. Refreshes FRED now and queues a refresh of the
 * government datasets (Census, BLS, FHFA), which the worker downloads in the background.
 */
export const POST = handler(async (request: Request) => {
  await requireAdmin(request);
  const results = await refreshAll();
  const govQueued = await enqueueNow("govdata.refresh", {}, { queue: "maintenance", dedupeKey: "govdata.refresh:manual", maxAttempts: 3 });
  return Response.json({ results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, govQueued });
});
