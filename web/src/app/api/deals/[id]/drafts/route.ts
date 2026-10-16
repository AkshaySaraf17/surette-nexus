import { z } from "zod";
import { requireStaff } from "@/lib/server/auth";
import { generateDealDraft } from "@/lib/server/drafts";
import { assertUuid, handler, validate } from "@/lib/server/http";
import { idempotentJson } from "@/lib/server/idempotency";

const schema = z.object({
  kind: z.enum(["status_update", "deadline_reminder", "document_request"]),
  itemId: z.uuid().nullable().optional(),
  useAi: z.boolean().default(false),
});

/** POST /api/deals/:id/drafts — prepare a client email for review (never sent automatically). */
export const POST = handler(async (request: Request, { params }: RouteContext<"/api/deals/[id]/drafts">) => {
  const { id } = await params;
  assertUuid(id, "Deal");
  const viewer = await requireStaff(request);
  return idempotentJson(request, viewer.id, async (raw) => {
    const input = validate(schema, raw);
    const draft = await generateDealDraft(viewer, id, input.kind, input.itemId ?? null, input.useAi);
    return Response.json({ draft }, { status: 201 });
  });
});
