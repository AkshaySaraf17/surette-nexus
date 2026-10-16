import "server-only";
import { createHmac } from "node:crypto";
import { breaker, BreakerOpenError } from "./circuit-breaker";
import { withSystemDb, type Db } from "./db";
import { publishEventNow, type DomainEventType } from "./events";
import { enqueue } from "./jobs";
import { childLogger } from "./logger";

/**
 * Outbound webhook notifications — event-driven and queued.
 *
 *   1. Business code records a domain event in the outbox (in its own transaction).
 *   2. The worker relays the event and enqueues one `webhook.deliver` job per matching
 *      subscription (`fanOutWebhooks`).
 *   3. Each job makes ONE delivery attempt (`deliverWebhook`). Failures throw, and the job
 *      queue retries with exponential backoff (up to 8 attempts over ~a day), then marks the
 *      job dead. Per-receiver circuit breakers stop hammering an endpoint that is down.
 *
 * Every delivery is a POST with:
 *   Content-Type: application/json
 *   X-Surette-Event: showing.requested
 *   X-Surette-Delivery: <uuid>            (stable across retries — receivers dedupe on it)
 *   X-Surette-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>
 *
 * Receivers should recompute the HMAC, compare in constant time, reject timestamps older
 * than five minutes and ignore deliveries they've already processed.
 */
export type WebhookEvent = Extract<
  DomainEventType,
  "listing.published" | "listing.updated" | "media.uploaded" | "showing.requested" | "showing.updated" | "collection.activity" | "lead.created" | "deal.stage_changed"
>;
export const WEBHOOK_EVENTS: WebhookEvent[] = ["listing.published", "listing.updated", "media.uploaded", "showing.requested", "showing.updated", "collection.activity", "lead.created", "deal.stage_changed"];

const TIMEOUT_MS = 8_000;
const log = childLogger("webhooks");

export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/**
 * Kept for existing call sites: records the event in the outbox. Delivery happens in the
 * worker, so API responses never wait on third-party endpoints.
 */
export async function emitWebhook(teamId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
  await publishEventNow({ type: event, teamId, aggregate: event.split(".")[0], aggregateId: String(data.propertyId ?? data.leadId ?? data.transactionId ?? data.showingId ?? data.collectionId ?? ""), payload: data });
}

/** Called by the outbox relay: one delivery job per active subscription for the event. */
export async function fanOutWebhooks(db: Db, event: { event_id: string; team_id: string | null; type: string; payload: Record<string, unknown>; created_at: Date }): Promise<number> {
  if (!event.team_id || !WEBHOOK_EVENTS.includes(event.type as WebhookEvent)) return 0;
  const subscriptions = await db.query<{ id: string }>(
    `SELECT id FROM webhook_subscriptions WHERE team_id = $1 AND is_active AND (cardinality(events) = 0 OR $2 = ANY(events))`,
    [event.team_id, event.type],
  );
  for (const s of subscriptions) {
    await enqueue(
      db,
      "webhook.deliver",
      { subscriptionId: s.id, event: event.type, deliveryId: event.event_id, createdAt: event.created_at.toISOString(), data: event.payload },
      { queue: "webhooks", maxAttempts: 8, dedupeKey: `webhook:${s.id}:${event.event_id}` },
    );
  }
  return subscriptions.length;
}

export class PermanentDeliveryError extends Error {}

/** One delivery attempt. Throws on retryable failure; returns quietly on success or permanent rejection. */
export async function deliverWebhook(job: { subscriptionId: string; event: string; deliveryId: string; createdAt: string; data: Record<string, unknown> }, attempt: number): Promise<void> {
  const subscription = await withSystemDb((db) =>
    db.one<{ id: string; url: string; secret: string; is_active: boolean }>("SELECT id, url, secret, is_active FROM webhook_subscriptions WHERE id = $1", [job.subscriptionId]),
  );
  if (!subscription?.is_active) return; // deleted or paused since the event — drop it

  const body = JSON.stringify({ id: job.deliveryId, event: job.event, createdAt: job.createdAt, data: job.data });
  const timestamp = Math.floor(Date.now() / 1000);
  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    const host = new URL(subscription.url).host;
    const response = await breaker(`webhook:${host}`, { failureThreshold: 5, resetAfterMs: 60_000, timeoutMs: TIMEOUT_MS }).exec(async (signal) => {
      const r = await fetch(subscription.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "SuretteNexus-Webhooks/1.0",
          "X-Surette-Event": job.event,
          "X-Surette-Delivery": job.deliveryId,
          "X-Surette-Signature": `t=${timestamp},v1=${signPayload(subscription.secret, timestamp, body)}`,
        },
        body,
        signal,
        redirect: "manual",
      });
      if (r.status >= 500 || r.status === 429) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
      return r;
    });
    statusCode = response.status;
    if (!response.ok) error = `HTTP ${response.status}`;
  } catch (e) {
    statusCode = (e as { status?: number }).status ?? null;
    error = e instanceof BreakerOpenError ? "receiver circuit open" : e instanceof Error ? e.message : String(e);
  }

  await withSystemDb((db) =>
    db.query(
      `INSERT INTO webhook_deliveries (subscription_id, event, payload, attempt, status_code, error, delivered_at)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6::text IS NULL THEN now() END)`,
      [subscription.id, job.event, body, attempt, statusCode, error],
    ),
  ).catch((e) => log.error({ err: (e as Error).message }, "could not log delivery"));

  if (!error) return;
  if (statusCode !== null && statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
    log.warn({ subscriptionId: subscription.id, statusCode }, "webhook rejected permanently");
    return; // the receiver said no; retrying won't help
  }
  throw new Error(`webhook delivery failed: ${error}`);
}
