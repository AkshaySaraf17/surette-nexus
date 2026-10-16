import { getViewer } from "@/lib/server/auth";
import { handler, parseBody, rateLimit } from "@/lib/server/http";
import { getSiteTeam } from "@/lib/server/listings";
import { runConcierge } from "@/lib/server/concierge";
import { conciergeRequestSchema } from "@/lib/validation";
import type { ConciergeEvent } from "@/lib/types";

/**
 * POST /api/agent/concierge — streams the concierge's reply as newline-delimited
 * JSON (application/x-ndjson): listing cards first, then text deltas, then an
 * optional showing proposal and a final `done` event. Clients render each line
 * as it arrives. Rate limited per IP.
 */
export const POST = handler(async (request: Request) => {
  await rateLimit(request, "concierge", 30, 10 * 60_000);
  const input = await parseBody(request, conciergeRequestSchema);
  const team = await getSiteTeam();
  const viewer = await getViewer(request);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ConciergeEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for await (const event of runConcierge(team, viewer, input.messages, input.listingSlug)) {
          if (request.signal.aborted) break;
          send(event);
        }
      } catch (error) {
        console.error("[concierge] failed", error);
        send({ type: "error", message: "The concierge is unavailable for a moment. Please try again, or call the office." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
});
