import client, { Counter, Gauge, Histogram, Registry } from "prom-client";

/**
 * Prometheus metrics (scraped from /api/metrics, the worker's :9464/metrics and the
 * realtime server's /metrics). One registry per process, kept on globalThis so dev
 * hot-reloads don't register metrics twice.
 */
interface Metrics {
  registry: Registry;
  httpDuration: Histogram<"method" | "route" | "status">;
  httpInFlight: Gauge;
  dbQueryDuration: Histogram<"kind">;
  dbPool: Gauge<"state">;
  rateLimited: Counter<"bucket">;
  idempotentReplays: Counter<"route">;
  cacheRequests: Counter<"cache" | "result">;
  breakerState: Gauge<"breaker">;
  breakerRejections: Counter<"breaker">;
  externalCallDuration: Histogram<"target" | "outcome">;
  jobsProcessed: Counter<"type" | "outcome">;
  jobDuration: Histogram<"type">;
  queueDepth: Gauge<"queue" | "status">;
  outboxLag: Gauge;
  outboxPublished: Counter<"type">;
  realtimeConnections: Gauge<"transport">;
  realtimeMessages: Counter<"transport">;
  analyticsEvents: Counter<"project" | "result">;
}

function create(): Metrics {
  const registry = new Registry();
  registry.setDefaultLabels({ service: process.env.SERVICE_NAME ?? "surette-web" });
  client.collectDefaultMetrics({ register: registry });
  const r = { registers: [registry] };
  return {
    registry,
    httpDuration: new Histogram({ name: "http_request_duration_seconds", help: "API request duration", labelNames: ["method", "route", "status"], buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10], ...r }),
    httpInFlight: new Gauge({ name: "http_requests_in_flight", help: "API requests being handled", ...r }),
    dbQueryDuration: new Histogram({ name: "db_transaction_duration_seconds", help: "Database transaction duration", labelNames: ["kind"], buckets: [0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5], ...r }),
    dbPool: new Gauge({ name: "db_pool_connections", help: "Postgres pool connections by state", labelNames: ["state"], ...r }),
    rateLimited: new Counter({ name: "rate_limited_total", help: "Requests rejected by the rate limiter", labelNames: ["bucket"], ...r }),
    idempotentReplays: new Counter({ name: "idempotent_replays_total", help: "Responses replayed for a repeated Idempotency-Key", labelNames: ["route"], ...r }),
    cacheRequests: new Counter({ name: "cache_requests_total", help: "Cache lookups", labelNames: ["cache", "result"], ...r }),
    breakerState: new Gauge({ name: "circuit_breaker_state", help: "0 = closed, 1 = half-open, 2 = open", labelNames: ["breaker"], ...r }),
    breakerRejections: new Counter({ name: "circuit_breaker_rejections_total", help: "Calls short-circuited by an open breaker", labelNames: ["breaker"], ...r }),
    externalCallDuration: new Histogram({ name: "external_call_duration_seconds", help: "Outbound calls (Ollama, FRED, dispatcher, webhooks)", labelNames: ["target", "outcome"], buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30], ...r }),
    jobsProcessed: new Counter({ name: "jobs_processed_total", help: "Jobs processed by outcome", labelNames: ["type", "outcome"], ...r }),
    jobDuration: new Histogram({ name: "job_duration_seconds", help: "Job run time", labelNames: ["type"], buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 60], ...r }),
    queueDepth: new Gauge({ name: "job_queue_depth", help: "Jobs by queue and status", labelNames: ["queue", "status"], ...r }),
    outboxLag: new Gauge({ name: "outbox_lag_seconds", help: "Age of the oldest unpublished outbox event", ...r }),
    outboxPublished: new Counter({ name: "outbox_published_total", help: "Outbox events relayed", labelNames: ["type"], ...r }),
    realtimeConnections: new Gauge({ name: "realtime_connections", help: "Open live-update connections", labelNames: ["transport"], ...r }),
    realtimeMessages: new Counter({ name: "realtime_messages_total", help: "Live-update messages sent", labelNames: ["transport"], ...r }),
    analyticsEvents: new Counter({ name: "analytics_events_total", help: "Analytics events received", labelNames: ["project", "result"], ...r }),
  };
}

const globalForMetrics = globalThis as unknown as { suretteMetrics?: Metrics };
export const metrics = (globalForMetrics.suretteMetrics ??= create());

/** Collapse ids in a path so metric labels stay low-cardinality: /api/deals/<uuid> → /api/deals/:id */
export function routeLabel(pathname: string): string {
  return pathname
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\/\d+(?=\/|$)/g, "/:n")
    .slice(0, 80);
}
