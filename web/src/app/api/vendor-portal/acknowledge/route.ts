import { z } from "zod";
import { handler, parseBody, rateLimit } from "@/lib/server/http";
import { dispatcherFetch } from "@/lib/server/dispatcher";

const schema = z.object({
  ticket: z.string().regex(/^T-[A-F0-9]{8}$/, "Invalid ticket."),
  vendor: z.string().min(1).max(80),
  sig: z.string().regex(/^[a-f0-9]{64}$/, "Invalid link."),
  eta: z.string().trim().max(200).optional(),
});

/** POST /api/vendor-portal/acknowledge — a contractor confirms receipt of a dispatch (signed link). */
export const POST = handler(async (request: Request) => {
  await rateLimit(request, "vendor-ack", 20, 15 * 60_000);
  const input = await parseBody(request, schema);
  const result = await dispatcherFetch<{ ticket_ref: string; acknowledged_at: string }>(
    `/api/v1/tickets/${encodeURIComponent(input.ticket)}/acknowledge`,
    { method: "POST", body: { vendor: input.vendor, sig: input.sig, eta: input.eta ?? null } },
  );
  return Response.json({ ticketRef: result.ticket_ref, acknowledgedAt: result.acknowledged_at });
});
