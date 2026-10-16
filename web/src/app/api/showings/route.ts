import { after } from "next/server";
import { contextFor, getViewer, requireViewer } from "@/lib/server/auth";
import { idempotentJson } from "@/lib/server/idempotency";
import { handler, rateLimit, validate } from "@/lib/server/http";
import { listShowings, requestShowing } from "@/lib/server/showings";
import { emitWebhook } from "@/lib/server/webhooks";
import { showingRequestSchema } from "@/lib/validation";
import { createLead } from "@/lib/server/leads";

/** GET /api/showings — staff: the team's showings; clients: their own. */
export const GET = handler(async (request: Request) => {
  const viewer = await requireViewer(request);
  const url = new URL(request.url);
  const showings = await listShowings(contextFor(viewer), { includePast: url.searchParams.get("past") === "1" });
  return Response.json({ showings });
});

/** POST /api/showings — request a private showing (public; signed-in clients are linked to it). */
export const POST = handler(async (request: Request) => {
  await rateLimit(request, "showings", 8, 60 * 60_000);
  const viewer = await getViewer(request);
  return idempotentJson(request, viewer?.id, async (raw) => {
    const input = validate(showingRequestSchema, raw);
    const created = await requestShowing(contextFor(viewer), viewer, input);
    // A showing request is an explicit ask for help, with consent: it becomes (or updates) a lead.
    await createLead({
      source: "showing_request",
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone ?? null,
      message: `Private showing requested for ${created.startsAt}${input.notes ? ` — ${input.notes}` : ""}`,
      propertyId: input.propertyId,
      clientUserId: viewer?.role === "client" ? viewer.id : null,
    });
    after(() =>
      emitWebhook(created.property.team_id, "showing.requested", {
        showingId: created.id,
        propertyId: created.property.id,
        propertyTitle: created.property.title,
        startsAt: created.startsAt,
        endsAt: created.endsAt,
        source: input.source,
        agentId: created.agentId,
      }),
    );
    return Response.json(
      { showing: { id: created.id, status: "requested", startsAt: created.startsAt, endsAt: created.endsAt, propertyTitle: created.property.title } },
      { status: 201 },
    );
  });
});
