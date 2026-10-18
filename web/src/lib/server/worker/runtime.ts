import { createServer, type Server } from "node:http";
import { Client } from "pg";
import { runAiIndex } from "../ai-index";
import { purgeExpired } from "../analytics";
import { purgeExpiredTokens } from "../auth-tokens";
import { sendEmail, type EmailMessage } from "../email";
import { refreshGovData } from "../gov-data";
import { invalidateTags } from "../cache";
import { getPool, withSystemDb } from "../db";
import { claimJobs, completeJob, enqueue, failJob, purgeFinishedJobs, queueStats, releaseStuckJobs, type Job } from "../jobs";
import { purgeIdempotencyKeys } from "../idempotency";
import { purgeRateLimitCounters } from "../limiter";
import { childLogger } from "../logger";
import { refreshAll } from "../market";
import { metrics } from "../metrics";
import { closeRedis } from "../redis";
import { runWithContext } from "../request-context";
import { deliverWebhook, fanOutWebhooks } from "../webhooks";

/**
 * The background worker: outbox relay + job processor + scheduler.
 *
 * Runs as its own process (`npm run worker`, the `worker` Deployment in Kubernetes) and
 * scales horizontally — jobs are claimed with SKIP LOCKED, the outbox relay locks rows the
 * same way, and only the replica holding a Postgres advisory lock enqueues scheduled work
 * (each scheduled job also has a per-period dedupe key, so a split brain can't double it).
 * In development the Next.js server can run an embedded worker (EMBEDDED_WORKER=1).
 */
const log = childLogger("worker");

type Handler = (job: Job) => Promise<void>;
const HANDLERS: Record<string, Handler> = {
  "webhook.deliver": (job) => deliverWebhook(job.payload as Parameters<typeof deliverWebhook>[0], job.attempts),
  "market.refresh": async () => {
    const results = (await refreshAll()) as unknown as { ok: boolean }[];
    const list = Array.isArray(results) ? results : [];
    log.info({ ok: list.filter((r) => r.ok).length, failed: list.filter((r) => !r.ok).length }, "market data refreshed");
  },
  "email.send": async (job) => {
    await sendEmail(job.payload as unknown as EmailMessage);
  },
  "govdata.refresh": async () => {
    log.info({ results: await refreshGovData() }, "government datasets refreshed");
  },
  "analytics.purge": async () => {
    log.info({ removed: await purgeExpired() }, "analytics events purged");
  },
  "ai.index": async () => {
    await runAiIndex();
  },
  "maintenance.cleanup": async () => {
    const [counters, keys, jobs, outbox, tokens] = await Promise.all([
      purgeRateLimitCounters(),
      purgeIdempotencyKeys(),
      purgeFinishedJobs(7),
      withSystemDb(async (db) => (await db.query("DELETE FROM outbox_events WHERE published_at < now() - interval '7 days' RETURNING 1")).length),
      purgeExpiredTokens(),
    ]);
    log.info({ counters, keys, jobs, outbox, tokens }, "cleanup done");
  },
};

/** Recurring work: [type, every N ms, dedupe period ms]. */
const SCHEDULES: { type: string; everyMs: number; queue?: string }[] = [
  { type: "maintenance.cleanup", everyMs: 60 * 60_000, queue: "maintenance" },
  // Embeds new documents and changed listings (cheap when nothing changed: hashes are compared first).
  { type: "ai.index", everyMs: 5 * 60_000 },
  { type: "analytics.purge", everyMs: 24 * 60 * 60_000, queue: "maintenance" },
  { type: "market.refresh", everyMs: 24 * 60 * 60_000, queue: "maintenance" },
  // Census, BLS, FHFA publish monthly/annually; a monthly check is plenty and polite.
  { type: "govdata.refresh", everyMs: 30 * 24 * 60 * 60_000, queue: "maintenance" },
];
const SCHEDULER_LOCK = 724_001; // arbitrary advisory-lock id for the scheduler leader

export interface WorkerOptions {
  id?: string;
  queues?: string[];
  concurrency?: number;
  port?: number | null;
  pollMs?: number;
}

export class Worker {
  readonly id: string;
  private queues: string[];
  private concurrency: number;
  private pollMs: number;
  private running = 0;
  private stopping = false;
  private listener: Client | null = null;
  private timers: NodeJS.Timeout[] = [];
  private server: Server | null = null;
  private wake: (() => void) | null = null;
  private lastLoopAt = 0;
  private schedulerConn: Client | null = null;

  constructor(private opts: WorkerOptions = {}) {
    this.id = opts.id ?? `worker-${process.pid}-${Math.random().toString(36).slice(2, 7)}`;
    this.queues = opts.queues ?? ["default", "webhooks", "maintenance"];
    this.concurrency = opts.concurrency ?? Number(process.env.WORKER_CONCURRENCY ?? 4);
    this.pollMs = opts.pollMs ?? 2_000;
  }

  async start() {
    log.info({ id: this.id, queues: this.queues, concurrency: this.concurrency }, "worker starting");
    await this.listen();
    void this.jobLoop();
    this.timers.push(setInterval(() => void this.relayOutbox().catch((e) => log.error({ err: e.message }, "outbox relay failed")), 5_000));
    this.timers.push(setInterval(() => void this.schedule().catch((e) => log.error({ err: e.message }, "scheduler failed")), 60_000));
    this.timers.push(setInterval(() => void this.collectMetrics().catch(() => undefined), 15_000));
    this.timers.push(setInterval(() => void releaseStuckJobs().then((n) => n && log.warn({ released: n }, "released stuck jobs")).catch(() => undefined), 60_000));
    void this.relayOutbox().catch(() => undefined);
    void this.schedule().catch(() => undefined);
    if (this.opts.port) this.serve(this.opts.port);
  }

  /** LISTEN for new outbox events and jobs so work starts within milliseconds. */
  private async listen() {
    const client = new Client({ connectionString: process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL });
    client.on("notification", (msg) => {
      if (msg.channel === "surette_outbox") void this.relayOutbox().catch(() => undefined);
      if (msg.channel === "surette_jobs") this.wake?.();
    });
    client.on("error", (e) => {
      log.warn({ err: e.message }, "listener connection lost; polling until it reconnects");
      this.listener = null;
      if (!this.stopping) setTimeout(() => void this.listen().catch(() => undefined), 5_000);
    });
    try {
      await client.connect();
      await client.query("LISTEN surette_outbox");
      await client.query("LISTEN surette_jobs");
      this.listener = client;
    } catch (e) {
      log.warn({ err: (e as Error).message }, "could not LISTEN; falling back to polling");
      if (!this.stopping) setTimeout(() => void this.listen().catch(() => undefined), 5_000);
    }
  }

  private relaying = false;
  /** Relay unpublished outbox events in id order, at-least-once. */
  async relayOutbox(): Promise<number> {
    if (this.relaying || this.stopping) return 0;
    this.relaying = true;
    try {
      let total = 0;
      for (;;) {
        const n = await withSystemDb(async (db) => {
          const events = await db.query<{ id: number; event_id: string; team_id: string | null; type: string; payload: Record<string, unknown>; created_at: Date }>(
            `SELECT id, event_id, team_id, type, payload, created_at FROM outbox_events
              WHERE published_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`,
          );
          for (const e of events) {
            await fanOutWebhooks(db, e);
            if (e.type.startsWith("listing.") || e.type === "media.uploaded") await invalidateTags(["listings"]);
            metrics.outboxPublished.inc({ type: e.type });
          }
          if (events.length) await db.query("UPDATE outbox_events SET published_at = now(), attempts = attempts + 1 WHERE id = ANY($1)", [events.map((e) => e.id)]);
          return events.length;
        });
        total += n;
        if (n < 100) break;
      }
      return total;
    } finally {
      this.relaying = false;
    }
  }

  private async jobLoop() {
    while (!this.stopping) {
      this.lastLoopAt = Date.now();
      const free = this.concurrency - this.running;
      let claimed: Job[] = [];
      if (free > 0) {
        try {
          claimed = await claimJobs(this.id, this.queues, free);
        } catch (e) {
          log.error({ err: (e as Error).message }, "claim failed");
        }
      }
      for (const job of claimed) void this.run(job);
      if (claimed.length === 0 || this.running >= this.concurrency) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, this.pollMs);
          this.wake = () => {
            clearTimeout(t);
            resolve();
          };
        });
        this.wake = null;
      }
    }
  }

  private async run(job: Job) {
    this.running++;
    const started = performance.now();
    await runWithContext({ requestId: `job-${job.id}`, route: job.type }, async () => {
      const handler = HANDLERS[job.type];
      try {
        if (!handler) throw new Error(`no handler for ${job.type}`);
        await handler(job);
        await completeJob(job.id);
        metrics.jobsProcessed.inc({ type: job.type, outcome: "succeeded" });
      } catch (error) {
        const dead = job.attempts >= job.max_attempts;
        await failJob(job, error).catch((e) => log.error({ err: e.message }, "could not record job failure"));
        metrics.jobsProcessed.inc({ type: job.type, outcome: dead ? "dead" : "retry" });
        log[dead ? "error" : "warn"]({ jobId: job.id, type: job.type, attempt: job.attempts, err: (error as Error).message }, dead ? "job moved to dead letter" : "job failed; will retry");
      } finally {
        metrics.jobDuration.observe({ type: job.type }, (performance.now() - started) / 1000);
        this.running--;
        this.wake?.();
      }
    });
  }

  /** Leader-only: enqueue recurring jobs, one per period (dedupe key = type + period). */
  async schedule() {
    if (this.stopping) return;
    this.schedulerConn ??= await (async () => {
      const c = new Client({ connectionString: process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL });
      c.on("error", () => (this.schedulerConn = null));
      await c.connect();
      return c;
    })();
    const { rows } = await this.schedulerConn.query<{ leader: boolean }>("SELECT pg_try_advisory_lock($1) AS leader", [SCHEDULER_LOCK]);
    if (!rows[0]?.leader) return;
    const now = Date.now();
    await withSystemDb(async (db) => {
      for (const s of SCHEDULES) {
        const period = Math.floor(now / s.everyMs);
        await enqueue(db, s.type, {}, { queue: s.queue, dedupeKey: `${s.type}:${period}`, maxAttempts: 3 });
      }
    });
  }

  private async collectMetrics() {
    metrics.queueDepth.reset();
    for (const r of await queueStats()) metrics.queueDepth.set({ queue: r.queue, status: r.status }, r.count);
    const lag = await withSystemDb((db) => db.one<{ s: number | null }>("SELECT extract(epoch FROM now() - min(created_at))::float AS s FROM outbox_events WHERE published_at IS NULL"));
    metrics.outboxLag.set(lag?.s ?? 0);
  }

  private serve(port: number) {
    this.server = createServer(async (req, res) => {
      if (req.url === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, id: this.id }));
      } else if (req.url === "/readyz") {
        const loopOk = Date.now() - this.lastLoopAt < this.pollMs * 5 + 30_000;
        const dbOk = await withSystemDb((db) => db.one("SELECT 1")).then(() => true, () => false);
        const ok = loopOk && dbOk && !this.stopping;
        res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" }).end(JSON.stringify({ ok, loop: loopOk, db: dbOk, listening: Boolean(this.listener), running: this.running }));
      } else if (req.url === "/metrics") {
        res.writeHead(200, { "Content-Type": metrics.registry.contentType }).end(await metrics.registry.metrics());
      } else res.writeHead(404).end();
    });
    this.server.listen(port, () => log.info({ port }, "worker health/metrics server listening"));
  }

  /** Graceful shutdown: stop claiming, let running jobs finish (up to `graceMs`). */
  async stop(graceMs = 25_000) {
    this.stopping = true;
    this.wake?.();
    for (const t of this.timers) clearInterval(t);
    const deadline = Date.now() + graceMs;
    while (this.running > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    await this.listener?.end().catch(() => undefined);
    await this.schedulerConn?.end().catch(() => undefined);
    this.server?.close();
    log.info({ id: this.id, unfinished: this.running }, "worker stopped");
  }
}

export async function closeWorkerResources() {
  await getPool().end().catch(() => undefined);
  await closeRedis();
}
