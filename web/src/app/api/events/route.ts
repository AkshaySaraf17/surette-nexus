import { getViewer } from "@/lib/server/auth";
import { handler } from "@/lib/server/http";
import { getSiteTeam } from "@/lib/server/listings";
import { canSee, toLiveEvent } from "@/lib/server/live-filter";
import { metrics } from "@/lib/server/metrics";
import { liveHub } from "@/lib/server/realtime";
import type { LiveEvent } from "@/lib/types";

/**
 * GET /api/events — Server-Sent Events stream of database changes the caller may see:
 *  - public listing/media changes for this site's team (everyone),
 *  - drafts, showings and internal changes for staff of that team,
 *  - collection activity for the collection's owner and assigned agent.
 * Events carry only ids; clients re-fetch through the API (where RLS applies).
 * A comment line every 20 s keeps proxies from closing idle connections.
 */
export const GET = handler(async (request: Request) => {
  const viewer = await getViewer(request);
  const team = await getSiteTeam();
  const encoder = new TextEncoder();

  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };
      write(`retry: 3000\nevent: ready\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);

      const unsubscribe = liveHub.subscribe((event) => {
        if (!canSee(event, viewer, team.id)) return;
        const payload: LiveEvent = toLiveEvent(event);
        write(`event: change\ndata: ${JSON.stringify(payload)}\n\n`);
        metrics.realtimeMessages.inc({ transport: "sse" });
      });
      metrics.realtimeConnections.inc({ transport: "sse" });
      const heartbeat = setInterval(() => write(`: keep-alive ${Date.now()}\n\n`), 20_000);

      let closed = false;
      cleanup = () => {
        if (!closed) {
          closed = true;
          metrics.realtimeConnections.dec({ transport: "sse" });
        }
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      request.signal.addEventListener("abort", () => cleanup(), { once: true });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
