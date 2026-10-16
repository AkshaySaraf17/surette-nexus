import { getViewer } from "@/lib/server/auth";
import { handler } from "@/lib/server/http";

/** GET /api/auth/session — the signed-in user or null (never 401; for the website's chrome). */
export const GET = handler(async (request: Request) => {
  const user = await getViewer(request);
  return Response.json({ user }, { headers: { "Cache-Control": "no-store" } });
});
