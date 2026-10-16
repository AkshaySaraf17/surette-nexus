import { createServer, type IncomingMessage, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { Viewer } from "@/lib/types";
import { SESSION_COOKIE, viewerFromToken } from "./auth";
import { canSee, toLiveEvent } from "./live-filter";
import { getSiteTeam } from "./listings";
import { childLogger } from "./logger";
import { metrics } from "./metrics";
import { liveHub } from "./realtime";

/**
 * WebSocket gateway for live updates (`npm run realtime`, the `realtime` Deployment).
 *
 * Same change feed and visibility rules as the SSE endpoint, over a WebSocket so the
 * mobile app and future two-way features (presence, typing, collaborative collections)
 * have a full-duplex channel. Each replica LISTENs to Postgres directly, so replicas scale
 * horizontally with no shared broker; the load balancer only needs WebSocket upgrades.
 *
 * Auth: the browser's session cookie (same-site, via the gateway at /ws — Origin must be
 * an allowed site origin, preventing cross-site WebSocket hijacking), or for native apps a
 * `bearer.<token>` WebSocket subprotocol (keeps tokens out of URLs and access logs).
 *
 * Protocol (JSON text frames):
 *   server → {"type":"ready","viewer":"client"|"agent"|"admin"|null}
 *   server → {"type":"change", table, op, propertyId, collectionId, transactionId, at}
 *   client → {"type":"ping"}  → server → {"type":"pong"}
 * Liveness: protocol-level ping every 25 s; connections that miss a pong are terminated.
 */
const log = childLogger("ws");
const MAX_PER_IP = Number(process.env.REALTIME_MAX_PER_IP ?? 20);
const MAX_BUFFERED = 1_000_000; // bytes; slow consumers are disconnected rather than buffering forever
const PROTOCOL = "surette.v1";

function allowedOrigins(): Set<string> {
  const list = [process.env.PUBLIC_SITE_URL, ...(process.env.CORS_ORIGINS ?? "").split(","), ...(process.env.REALTIME_ALLOWED_ORIGINS ?? "").split(",")];
  return new Set(list.map((o) => o?.trim().replace(/\/$/, "")).filter((o): o is string => Boolean(o)));
}

function cookieToken(req: IncomingMessage): string | undefined {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function bearerFromProtocols(req: IncomingMessage): string | undefined {
  const protocols = (req.headers["sec-websocket-protocol"] ?? "").split(",").map((p) => p.trim());
  return protocols.find((p) => p.startsWith("bearer."))?.slice("bearer.".length);
}

function ipOf(req: IncomingMessage): string {
  return (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
}

export interface RealtimeServer {
  server: Server;
  close(): Promise<void>;
  connections(): number;
}

export function startRealtimeServer(port: number): Promise<RealtimeServer> {
  const perIp = new Map<string, number>();
  const alive = new WeakMap<WebSocket, boolean>();
  let siteTeamId: string | null = null;
  let draining = false;

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4 * 1024,
    handleProtocols: (protocols) => (protocols.has(PROTOCOL) ? PROTOCOL : false),
  });

  const server = createServer(async (req, res) => {
    if (req.url === "/healthz") return void res.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
    if (req.url === "/readyz") {
      const ok = !draining;
      return void res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" }).end(JSON.stringify({ ok, connections: wss.clients.size, listening: liveHub.size > 0 }));
    }
    if (req.url === "/metrics") return void res.writeHead(200, { "Content-Type": metrics.registry.contentType }).end(await metrics.registry.metrics());
    res.writeHead(404).end();
  });

  server.on("upgrade", async (req, socket, head) => {
    const reject = (code: number, reason: string) => {
      socket.write(`HTTP/1.1 ${code} ${reason}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/ws") return reject(404, "Not Found");
      if (draining) return reject(503, "Service Unavailable");
      const ip = ipOf(req);
      if ((perIp.get(ip) ?? 0) >= MAX_PER_IP) return reject(429, "Too Many Requests");

      const bearer = bearerFromProtocols(req);
      const cookie = cookieToken(req);
      if (cookie && !bearer) {
        // Cookie auth is ambient: only accept it from our own pages.
        const origin = req.headers.origin?.replace(/\/$/, "");
        if (!origin || !allowedOrigins().has(origin)) return reject(403, "Forbidden");
      }
      const viewer: Viewer | null = await viewerFromToken(bearer ?? cookie).catch(() => null);
      siteTeamId ??= (await getSiteTeam()).id;

      wss.handleUpgrade(req, socket, head, (ws) => {
        perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
        alive.set(ws, true);
        metrics.realtimeConnections.inc({ transport: "websocket" });
        ws.on("pong", () => alive.set(ws, true));
        ws.on("message", (data) => {
          try {
            const msg = JSON.parse(String(data)) as { type?: string };
            if (msg.type === "ping") ws.send('{"type":"pong"}');
          } catch {
            // ignore malformed frames
          }
        });
        const unsubscribe = liveHub.subscribe((event) => {
          if (!canSee(event, viewer, siteTeamId!)) return;
          if (ws.bufferedAmount > MAX_BUFFERED) return void ws.terminate();
          ws.send(JSON.stringify({ type: "change", ...toLiveEvent(event) }));
          metrics.realtimeMessages.inc({ transport: "websocket" });
        });
        ws.on("close", () => {
          unsubscribe();
          const n = (perIp.get(ip) ?? 1) - 1;
          if (n <= 0) perIp.delete(ip);
          else perIp.set(ip, n);
          metrics.realtimeConnections.dec({ transport: "websocket" });
        });
        ws.send(JSON.stringify({ type: "ready", viewer: viewer?.role ?? null }));
      });
    } catch (error) {
      log.error({ err: (error as Error).message }, "upgrade failed");
      reject(500, "Internal Server Error");
    }
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, 25_000);

  return new Promise((resolve) => {
    server.listen(port, () => {
      log.info({ port }, "realtime server listening");
      resolve({
        server,
        connections: () => wss.clients.size,
        async close() {
          // Graceful drain: refuse new upgrades, tell clients to reconnect elsewhere (1012 = service restart).
          draining = true;
          clearInterval(heartbeat);
          for (const ws of wss.clients) ws.close(1012, "server restarting");
          await new Promise((r) => setTimeout(r, 500));
          for (const ws of wss.clients) ws.terminate();
          await new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  });
}
