import { z } from "zod";
import { handler, parseBody, rateLimit } from "@/lib/server/http";
import { dispatcherFetch, type TenantAlertResult } from "@/lib/server/dispatcher";
import { e164 } from "@/lib/validation";

const schema = z.object({
  phone: e164,
  message: z.string().trim().min(10, "Please describe the problem in a sentence or two.").max(2000, "Please keep it under 2,000 characters."),
  // Honeypot: real visitors never fill this hidden field.
  website: z.string().max(0, "Invalid submission.").optional(),
});

/**
 * POST /api/maintenance — the tenant intake widget. Validates and rate-limits on
 * this site, then forwards to the dispatcher's /api/v1/tenant-alert. Only a
 * minimal, tenant-safe summary comes back (never vendor contact details).
 */
export const POST = handler(async (request: Request) => {
  await rateLimit(request, "maintenance", 5, 15 * 60_000);
  const input = await parseBody(request, schema);
  const result = await dispatcherFetch<TenantAlertResult>("/api/v1/tenant-alert", {
    method: "POST",
    body: { phone_number: input.phone, message_body: input.message, source: "website" },
  });
  return Response.json(
    {
      ticketRef: result.ticket_ref,
      trade: result.triage.trade_required,
      urgency: result.triage.urgency,
      summary: result.triage.clean_summary,
    },
    { status: 201 },
  );
});
