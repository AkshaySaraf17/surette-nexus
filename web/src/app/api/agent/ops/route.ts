import { z } from "zod";
import { requireStaff } from "@/lib/server/auth";
import { handler, parseBody, rateLimit } from "@/lib/server/http";
import { answerOps } from "@/lib/server/ops-assistant";

const schema = z.object({ question: z.string().trim().min(1).max(500) });

/** POST /api/agent/ops — the team's operations assistant (staff only, RLS-scoped answers). */
export const POST = handler(async (request: Request) => {
  await rateLimit(request, "ops", 60, 60_000);
  const viewer = await requireStaff(request);
  const { question } = await parseBody(request, schema);
  return Response.json(await answerOps(viewer, question));
});
