import { z } from "zod";
import { agentBriefing, analyze, dualMoveInputSchema } from "@/lib/dual-move";
import { getViewer } from "@/lib/server/auth";
import { idempotentJson } from "@/lib/server/idempotency";
import { handler, rateLimit, validate } from "@/lib/server/http";
import { createLead } from "@/lib/server/leads";
import { consentToContact, e164 } from "@/lib/validation";

const schema = z
  .object({
    inputs: dualMoveInputSchema,
    contactName: z.string().trim().min(1, "Name is required.").max(120),
    contactEmail: z.email("Enter a valid email.").trim().toLowerCase().optional().nullable(),
    contactPhone: e164.optional().nullable(),
    message: z.string().trim().max(2000).optional().nullable(),
    consentContact: consentToContact,
  })
  .refine((v) => v.contactEmail || v.contactPhone, { path: ["contactEmail"], message: "Add an email or phone number." });

/** POST /api/dual-move/share — the customer chooses to send their plan to an agent (creates a lead). */
export const POST = handler(async (request: Request) => {
  await rateLimit(request, "dual-move-share", 5, 60 * 60_000);
  const viewer = await getViewer(request);
  return idempotentJson(request, viewer?.id, async (raw) => {
    const input = validate(schema, raw);
    const result = analyze(input.inputs);
    const lead = await createLead({
      source: "dual_move",
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      message: input.message ?? "Please review my sell-and-buy plan.",
      clientUserId: viewer?.role === "client" ? viewer.id : null,
      preferences: { target_price_cents: input.inputs.newPriceCents, plan: input.inputs.sellFirst ? "sell_first" : "buy_first", timeline_months: input.inputs.timelineMonths },
      summary: agentBriefing(input.inputs, result),
    });
    return Response.json({ leadId: lead.id, duplicate: lead.duplicate }, { status: 201 });
  });
});
