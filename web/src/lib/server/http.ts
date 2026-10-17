import "server-only";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { ApiError } from "./errors";

export { ApiError, assertUuid, notFound, parseBody, validate, zodFields } from "./errors";
import { isPgError, PG } from "./db";
import { hit, clientIp } from "./limiter";
import { childLogger } from "./logger";
import { metrics, routeLabel } from "./metrics";
import { currentContext, requestIdFrom, runWithContext } from "./request-context";

const log = childLogger("http");

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json(
      { error: { code: error.code, message: error.message, ...(error.fields && { fields: error.fields }) } },
      { status: error.status, headers: error.headers },
    );
  }
  if (isPgError(error, PG.UNIQUE_VIOLATION)) {
    return Response.json({ error: { code: "CONFLICT", message: "A record with these details already exists." } }, { status: 409 });
  }
  if (isPgError(error, PG.EXCLUSION_VIOLATION)) {
    return Response.json(
      { error: { code: "SLOT_TAKEN", message: "That time overlaps a confirmed showing. Please pick another slot." } },
      { status: 409 },
    );
  }
  if (isPgError(error, PG.CHECK_VIOLATION)) {
    return Response.json({ error: { code: "INVALID_DATA", message: "Some values are out of range." } }, { status: 422 });
  }
  if (isPgError(error, PG.RLS_VIOLATION)) {
    return Response.json({ error: { code: "FORBIDDEN", message: "You don't have access to do that." } }, { status: 403 });
  }
  log.error({ err: error instanceof Error ? { message: error.message, stack: error.stack } : String(error) }, "unhandled error");
  return Response.json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } }, { status: 500 });
}

/**
 * Wrap a route handler so thrown ApiErrors (and unexpected errors) become JSON responses.
 * Also: request id (from the gateway's X-Request-Id or minted), structured access log,
 * latency/in-flight metrics, and the X-Request-Id response header for support tickets.
 * Marks the route request-time up front; Next.js control-flow errors are re-thrown.
 */
export function handler<Args extends unknown[]>(fn: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    const request = args[0] instanceof Request ? args[0] : null;
    const requestId = request ? requestIdFrom(request.headers) : crypto.randomUUID();
    const route = request ? routeLabel(new URL(request.url).pathname) : "unknown";
    const method = request?.method ?? "GET";
    const started = performance.now();
    metrics.httpInFlight.inc();
    let response: Response;
    try {
      response = await runWithContext({ requestId, route }, async () => {
        try {
          await connection();
          return await fn(...args);
        } catch (error) {
          unstable_rethrow(error);
          return errorResponse(error);
        }
      });
    } finally {
      metrics.httpInFlight.dec();
    }
    const seconds = (performance.now() - started) / 1000;
    metrics.httpDuration.observe({ method, route, status: String(response.status) }, seconds);
    try {
      response.headers.set("X-Request-Id", requestId);
    } catch {
      // immutable headers (e.g. redirects) — fine
    }
    // Streaming responses (SSE, AI assistant) are logged when they start, not when they end.
    const line = { requestId, method, route, status: response.status, ms: Math.round(seconds * 1000) };
    if (response.status >= 500) log.error(line, "request failed");
    else if (seconds > 2) log.warn(line, "slow request");
    else log.info(line, "request");
    return response;
  };
}

/**
 * Per-client rate limit for public endpoints. Shared across instances (Redis or Postgres,
 * see limiter.ts). Throws 429 with Retry-After and RateLimit-* headers when exceeded.
 */
export async function rateLimit(request: Request, bucket: string, limit: number, windowMs: number): Promise<void> {
  const subject = currentContext()?.userId ?? clientIp(request);
  const result = await hit(bucket, subject, limit, windowMs);
  if (!result.allowed) {
    const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    throw new ApiError(429, "RATE_LIMITED", "Too many requests. Please wait a moment and try again.", undefined, {
      "Retry-After": String(retryAfter),
      "RateLimit-Limit": String(limit),
      "RateLimit-Remaining": "0",
      "RateLimit-Reset": String(retryAfter),
    });
  }
}
