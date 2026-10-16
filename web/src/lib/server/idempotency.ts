import { createHash } from "node:crypto";
import { withSystemDb } from "./db";
import { ApiError } from "./errors";
import { clientIp } from "./limiter";
import { metrics, routeLabel } from "./metrics";

/**
 * Idempotency-Key support for POST endpoints that create things (leads, showings, deals,
 * uploads, documents, drafts).
 *
 * A client that retries (flaky mobile network, double-click, gateway retry) sends the
 * same `Idempotency-Key` header. The first request runs and its response is stored for
 * 24 hours; repeats get the stored response with `Idempotent-Replayed: true` instead of
 * creating a duplicate. Reusing a key with a different body is a 422; a repeat that
 * arrives while the first is still running gets 409 so the client can retry shortly.
 * Keys are scoped to the signed-in user (or the IP for anonymous requests).
 * Requests without the header behave exactly as before.
 */
const KEY = /^[A-Za-z0-9_:.-]{8,128}$/;

export async function withIdempotency(
  request: Request,
  scopeUserId: string | null | undefined,
  bodyForHash: string,
  run: () => Promise<Response>,
): Promise<Response> {
  const key = request.headers.get("idempotency-key");
  if (!key) return run();
  if (!KEY.test(key)) throw new ApiError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be 8–128 letters, digits or _ : . -");

  const scope = scopeUserId ? `user:${scopeUserId}` : `ip:${clientIp(request)}`;
  const url = new URL(request.url);
  const requestHash = createHash("sha256").update(`${request.method} ${url.pathname}\n${bodyForHash}`).digest("hex");

  type Row = { inserted: boolean; request_hash: string; status: string; response_code: number | null; response_body: string | null; response_type: string | null };
  const claim = () =>
    withSystemDb((db) =>
      db.one<Row>(
        `WITH ins AS (
           INSERT INTO idempotency_keys (scope, key, method, path, request_hash)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (scope, key) DO UPDATE
             SET request_hash = EXCLUDED.request_hash, status = 'in_progress', response_code = NULL, response_body = NULL,
                 response_type = NULL, created_at = now(), expires_at = now() + interval '24 hours'
             WHERE idempotency_keys.expires_at <= now()          -- only an expired key may be taken over
           RETURNING true AS inserted, request_hash, status, response_code, response_body, response_type)
         SELECT * FROM ins`,
        [scope, key, request.method, url.pathname, requestHash],
      ),
    );
  // Either we now own the key, or someone else does: read their row (fresh snapshot).
  const owned = await claim();
  const existing = owned
    ? null
    : await withSystemDb((db) =>
        db.one<Row>("SELECT false AS inserted, request_hash, status, response_code, response_body, response_type FROM idempotency_keys WHERE scope = $1 AND key = $2", [scope, key]),
      );

  if (!owned) {
    if (!existing) throw new ApiError(409, "REQUEST_IN_PROGRESS", "The original request is still being processed. Retry in a moment.");
    if (existing.request_hash !== requestHash) throw new ApiError(422, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used with a different request.");
    if (existing.status === "in_progress") throw new ApiError(409, "REQUEST_IN_PROGRESS", "The original request is still being processed. Retry in a moment.");
    metrics.idempotentReplays.inc({ route: routeLabel(url.pathname) });
    return new Response(existing.response_body, {
      status: existing.response_code ?? 200,
      headers: { "Content-Type": existing.response_type ?? "application/json", "Idempotent-Replayed": "true" },
    });
  }

  let response: Response;
  try {
    response = await run();
  } catch (error) {
    // Failed before producing a response: release the key so the client can retry.
    await withSystemDb((db) => db.query("DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2", [scope, key])).catch(() => undefined);
    throw error;
  }
  // Only successful and client-error JSON responses are final; 5xx may succeed on retry,
  // and streaming responses can't be buffered for replay without breaking the stream.
  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  if (response.status >= 500 || !isJson) {
    await withSystemDb((db) => db.query("DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2", [scope, key])).catch(() => undefined);
    return response;
  }
  const body = await response.clone().text();
  await withSystemDb((db) =>
    db.query(
      `UPDATE idempotency_keys SET status = 'completed', response_code = $3, response_body = $4, response_type = $5
        WHERE scope = $1 AND key = $2`,
      [scope, key, response.status, body.slice(0, 256_000), response.headers.get("content-type")],
    ),
  );
  return response;
}

export async function purgeIdempotencyKeys(): Promise<number> {
  return withSystemDb(async (db) => (await db.query("DELETE FROM idempotency_keys WHERE expires_at < now() RETURNING 1")).length);
}

/**
 * JSON variant: reads the body once (to hash it), then hands the parsed value to `run`.
 * Routes call `validate(schema, raw)` inside `run` instead of `parseBody`.
 */
export async function idempotentJson(request: Request, scopeUserId: string | null | undefined, run: (raw: unknown) => Promise<Response>): Promise<Response> {
  const text = await request.text();
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
  return withIdempotency(request, scopeUserId, text, () => run(raw));
}

/** Multipart uploads stream straight to storage, so they're keyed on type + size rather than content. */
export function multipartFingerprint(request: Request): string {
  const type = (request.headers.get("content-type") ?? "").split(";")[0];
  return `${type}:${request.headers.get("content-length") ?? "?"}`;
}
