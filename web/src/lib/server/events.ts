import type { Db } from "./db";
import { withSystemDb } from "./db";

/**
 * Domain events via a transactional outbox.
 *
 * `publishEvent(db, …)` inserts the event using the SAME transaction as the business
 * change, so an event exists if and only if the change committed — no lost or phantom
 * events, no dual-write problem. The worker relays new rows (woken by NOTIFY
 * `surette_outbox`, with polling as a safety net), turns them into jobs (webhook
 * deliveries, notifications, cache invalidation) and marks them published.
 * Consumers must be idempotent: every event has a stable `event_id`.
 */
export type DomainEventType =
  | "lead.created"
  | "lead.assigned"
  | "deal.created"
  | "deal.stage_changed"
  | "document.uploaded"
  | "showing.requested"
  | "showing.updated"
  | "listing.published"
  | "listing.updated"
  | "media.uploaded"
  | "collection.activity";

export interface DomainEvent {
  type: DomainEventType;
  teamId: string | null;
  aggregate: string;
  aggregateId?: string | null;
  payload?: Record<string, unknown>;
}

export async function publishEvent(db: Db, event: DomainEvent): Promise<void> {
  await db.query(
    "INSERT INTO outbox_events (team_id, type, aggregate, aggregate_id, payload) VALUES ($1, $2, $3, $4, $5)",
    [event.teamId, event.type, event.aggregate, event.aggregateId ?? null, JSON.stringify(event.payload ?? {})],
  );
}

/** For code paths that already committed: record the event in its own transaction. */
export function publishEventNow(event: DomainEvent): Promise<void> {
  return withSystemDb((db) => publishEvent(db, event));
}
