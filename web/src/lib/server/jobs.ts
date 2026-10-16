import type { Db } from "./db";
import { withSystemDb } from "./db";

/**
 * Durable job queue on PostgreSQL.
 *
 * Workers claim jobs with `FOR UPDATE SKIP LOCKED`, so any number of worker replicas can
 * pull from the same queue without double-processing. Failed jobs retry with exponential
 * backoff plus jitter; after `max_attempts` they move to `dead` (the dead-letter state),
 * which is alerted on and can be re-queued from SQL. Jobs stuck in `running` (a worker
 * crashed) are released after a visibility timeout. A `dedupe_key` keeps at most one
 * queued/running job per key (e.g. one market refresh at a time).
 */
export interface Job {
  id: number;
  queue: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export interface EnqueueOptions {
  queue?: string;
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
  dedupeKey?: string;
}

export async function enqueue(db: Db, type: string, payload: Record<string, unknown> = {}, opts: EnqueueOptions = {}): Promise<boolean> {
  const rows = await db.query(
    `INSERT INTO jobs (queue, type, payload, run_at, priority, max_attempts, dedupe_key)
     VALUES ($1, $2, $3, COALESCE($4, now()), $5, $6, $7)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running') DO NOTHING
     RETURNING id`,
    [opts.queue ?? "default", type, JSON.stringify(payload), opts.runAt ?? null, opts.priority ?? 0, opts.maxAttempts ?? 5, opts.dedupeKey ?? null],
  );
  return rows.length > 0;
}

export function enqueueNow(type: string, payload: Record<string, unknown> = {}, opts: EnqueueOptions = {}) {
  return withSystemDb((db) => enqueue(db, type, payload, opts));
}

/** Claim up to `limit` ready jobs for this worker. */
export function claimJobs(workerId: string, queues: string[], limit: number): Promise<Job[]> {
  return withSystemDb((db) =>
    db.query<Job>(
      `UPDATE jobs SET status = 'running', locked_at = now(), locked_by = $1, attempts = attempts + 1
        WHERE id IN (
          SELECT id FROM jobs
           WHERE status = 'queued' AND queue = ANY($2) AND run_at <= now()
           ORDER BY priority DESC, run_at, id
           LIMIT $3
           FOR UPDATE SKIP LOCKED)
        RETURNING id, queue, type, payload, attempts, max_attempts`,
      [workerId, queues, limit],
    ),
  );
}

export function completeJob(id: number) {
  return withSystemDb((db) => db.query("UPDATE jobs SET status = 'succeeded', finished_at = now(), locked_at = NULL, last_error = NULL WHERE id = $1", [id]));
}

/** Exponential backoff: 5 s, 20 s, 80 s, … capped at 1 h, ±20% jitter. */
export function backoffMs(attempt: number, random = Math.random): number {
  const base = Math.min(5_000 * 4 ** (attempt - 1), 3_600_000);
  return Math.round(base * (0.8 + random() * 0.4));
}

export function failJob(job: Job, error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
  const dead = job.attempts >= job.max_attempts;
  return withSystemDb((db) =>
    db.query(
      `UPDATE jobs SET status = $2::job_status, last_error = $3, locked_at = NULL, locked_by = NULL,
              run_at = CASE WHEN $2 = 'queued' THEN now() + ($4 || ' milliseconds')::interval ELSE run_at END,
              finished_at = CASE WHEN $2 = 'dead' THEN now() ELSE NULL END
        WHERE id = $1`,
      [job.id, dead ? "dead" : "queued", message, String(backoffMs(job.attempts))],
    ),
  );
}

/** Put jobs whose worker vanished back in the queue. */
export function releaseStuckJobs(visibilityTimeoutMs = 5 * 60_000) {
  return withSystemDb(async (db) =>
    (await db.query(
      `UPDATE jobs SET status = 'queued', locked_at = NULL, locked_by = NULL, last_error = 'released after visibility timeout'
        WHERE status = 'running' AND locked_at < now() - ($1 || ' milliseconds')::interval RETURNING id`,
      [String(visibilityTimeoutMs)],
    )).length,
  );
}

export function queueStats() {
  return withSystemDb((db) =>
    db.query<{ queue: string; status: string; count: number }>("SELECT queue, status::text, count(*)::int AS count FROM jobs GROUP BY 1, 2"),
  );
}

export function purgeFinishedJobs(olderThanDays = 7) {
  return withSystemDb(async (db) =>
    (await db.query("DELETE FROM jobs WHERE status = 'succeeded' AND finished_at < now() - ($1 || ' days')::interval RETURNING 1", [String(olderThanDays)])).length,
  );
}
