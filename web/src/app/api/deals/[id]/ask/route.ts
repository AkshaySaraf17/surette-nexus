import { z } from "zod";
import { requireStaff } from "@/lib/server/auth";
import { askDocuments } from "@/lib/server/doc-qa";
import { assertUuid, handler, parseBody, rateLimit } from "@/lib/server/http";

const askSchema = z.object({ question: z.string().trim().min(3, "Ask a question.").max(500, "Keep it under 500 characters.") });

/** POST /api/deals/:id/ask — answer a question from this deal's documents, with page citations. */
export const POST = handler(async (request: Request, { params }: RouteContext<"/api/deals/[id]/ask">) => {
  const { id } = await params;
  assertUuid(id, "Deal");
  const viewer = await requireStaff(request);
  await rateLimit(request, "deal-ask", 30, 10 * 60_000);
  const { question } = await parseBody(request, askSchema);
  return Response.json(await askDocuments(viewer, id, question));
});
