import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge rules for /api/*:
 *  1. CORS for approved browser origins (Expo web, the client's existing website).
 *     The analytics collector has its own per-project origin list (see /api/analytics/collect).
 *  2. CSRF defence for cookie-authenticated writes: a state-changing request that carries
 *     the session cookie must come from this site (or an approved origin). Bearer-token
 *     requests (mobile app) don't use cookies and are unaffected.
 *  3. Request ids: the gateway's X-Request-Id is kept (or one is minted) and echoed back,
 *     so a support ticket can be traced through gateway, app and worker logs.
 */
const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:8081")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const corsHeaders = {
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key, X-Request-Id",
  "Access-Control-Expose-Headers": "X-Request-Id, Idempotent-Replayed, Retry-After, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset",
  "Access-Control-Max-Age": "600",
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const REQUEST_ID = /^[A-Za-z0-9_.:-]{8,128}$/;

export function proxy(request: NextRequest) {
  const incomingId = request.headers.get("x-request-id");
  const requestId = incomingId && REQUEST_ID.test(incomingId) ? incomingId : crypto.randomUUID();
  const origin = request.headers.get("origin") ?? "";
  const path = request.nextUrl.pathname;
  const isCollector = path === "/api/analytics/collect";
  const allowed = allowedOrigins.includes(origin);

  if (request.method === "OPTIONS") {
    if (isCollector) return NextResponse.next(); // the route answers its own preflight
    return new NextResponse(null, {
      status: 204,
      headers: allowed ? { "Access-Control-Allow-Origin": origin, Vary: "Origin", ...corsHeaders } : {},
    });
  }

  if (!SAFE_METHODS.has(request.method) && !isCollector && request.cookies.has("sn_session") && !request.headers.get("authorization")) {
    const sameOrigin = origin === request.nextUrl.origin;
    if (origin && !sameOrigin && !allowed) {
      return NextResponse.json({ error: { code: "BAD_ORIGIN", message: "This request came from another website and was blocked." } }, { status: 403 });
    }
    // Browsers always send Origin on cross-site POSTs; also require JSON or multipart, which simple cross-site forms can't send with credentials unnoticed.
    const type = request.headers.get("content-type") ?? "";
    if (!origin && type && !type.startsWith("application/json") && !type.startsWith("multipart/form-data")) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Unsupported content type." } }, { status: 415 });
    }
  }

  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("X-Request-Id", requestId);
  if (allowed && !isCollector) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
    for (const [key, value] of Object.entries(corsHeaders)) response.headers.set(key, value);
  }
  return response;
}

export const config = { matcher: "/api/:path*" };
