import "server-only";
import { Client } from "pg";
import { childLogger } from "./logger";

const log = childLogger("realtime");

/**
 * Real-time change feed.
 *
 * Database triggers (database/schema.sql → notify_surette_event) publish a
 * small JSON payload on the Postgres channel `surette_events` after every
 * change to listings, media, showings and collections — no matter who made it
 * (website, mobile app, admin portal or raw SQL). This module keeps ONE
 * dedicated LISTEN connection per server process and fans each notification
 * out to the open Server-Sent Event streams (see /api/events), reconnecting
 * with backoff if the connection drops. Several server instances each listen
 * independently, so it scales horizontally without extra infrastructure.
 */

export interface RawEvent {
  table: "properties" | "media_assets" | "showings" | "collections" | "collection_items" | "collection_comments" | "leads" | "transactions" | "transaction_milestones" | "transaction_tasks" | "transaction_documents";
  op: "insert" | "update" | "delete";
  visibility: "public" | "staff" | "collection";
  propertyId: string | null;
  collectionId: string | null;
  transactionId?: string | null;
  teamId: string | null;
  ownerId: string | null;
  agentId: string | null;
  at: number;
}

type Listener = (event: RawEvent) => void;

class LiveHub {
  private listeners = new Set<Listener>();
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;
  private retryMs = 1_000;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    void this.ensureConnected();
    return () => {
      this.listeners.delete(listener);
    };
  }

  get size() {
    return this.listeners.size;
  }

  private ensureConnected(): Promise<void> {
    if (this.client) return Promise.resolve();
    this.connecting ??= this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(): Promise<void> {
    // LISTEN needs a session connection: bypass PgBouncer (transaction pooling) when configured.
    const client = new Client({ connectionString: process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL });
    client.on("notification", (message) => {
      if (message.channel !== "surette_events" || !message.payload) return;
      let event: RawEvent;
      try {
        event = JSON.parse(message.payload) as RawEvent;
      } catch {
        return;
      }
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch (error) {
          log.error({ err: (error as Error).message }, "listener failed");
        }
      }
    });
    const reconnect = () => {
      if (this.client !== client) return;
      this.client = null;
      client.removeAllListeners();
      client.end().catch(() => undefined);
      const delay = this.retryMs;
      this.retryMs = Math.min(this.retryMs * 2, 30_000);
      setTimeout(() => {
        if (this.listeners.size > 0) void this.ensureConnected();
      }, delay);
    };
    client.on("error", (error) => {
      log.warn({ err: error.message }, "connection error");
      reconnect();
    });
    client.on("end", reconnect);
    try {
      await client.connect();
      await client.query("LISTEN surette_events");
      this.client = client;
      this.retryMs = 1_000;
    } catch (error) {
      log.warn({ err: error instanceof Error ? error.message : String(error) }, "could not connect");
      client.removeAllListeners();
      await client.end().catch(() => undefined);
      const delay = this.retryMs;
      this.retryMs = Math.min(this.retryMs * 2, 30_000);
      setTimeout(() => {
        if (this.listeners.size > 0) void this.ensureConnected();
      }, delay);
    }
  }
}

const globalForHub = globalThis as unknown as { suretteLiveHub?: LiveHub };
export const liveHub = (globalForHub.suretteLiveHub ??= new LiveHub());
