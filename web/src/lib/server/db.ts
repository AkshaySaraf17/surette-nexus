import "server-only";
import { Pool, types, type PoolClient, type QueryResultRow } from "pg";
import { childLogger } from "./logger";
import { metrics } from "./metrics";

const log = childLogger("db");

/**
 * PostgreSQL access.
 *
 * Every request-scoped query runs through `withDb(context, fn)`, which opens a
 * transaction, switches to the NOLOGIN role `surette_app` and stores the
 * caller's identity in transaction-local settings. The Row-Level Security
 * policies in database/schema.sql read those settings, so even a buggy query
 * cannot return another client's collection or a team's internal utility bills.
 *
 * `withSystemDb` runs as the connecting (owner) role and bypasses RLS. It is
 * used only for authentication (password hashes are invisible to surette_app),
 * the real-time listener, outbound webhooks and seeding.
 */

// BIGINT (money in cents) → number, refusing anything beyond 2^53.
types.setTypeParser(20, (value: string) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`Integer ${value} exceeds the safe range`);
  return n;
});
// NUMERIC is only used for coordinates.
types.setTypeParser(1700, (value: string) => Number(value));
// DATE stays a plain "YYYY-MM-DD" string (no timezone shifting).
types.setTypeParser(1082, (value: string) => value);

const globalForDb = globalThis as unknown as { surettePool?: Pool; suretteReadPool?: Pool | null };

function createPool(connectionString = process.env.DATABASE_URL, label = "primary"): Pool {
  if (!connectionString) throw new Error("DATABASE_URL is not set. Copy web/.env.example to web/.env.");
  const pool = new Pool({
    application_name: `${process.env.SERVICE_NAME ?? "surette-web"}:${label}`,
    // Abort runaway queries instead of letting them hold a connection.
    statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS ?? 15_000),
    connectionString,
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on("error", (error) => log.error({ err: error.message, pool: label }, "idle client error"));
  return pool;
}

export function getPool(): Pool {
  globalForDb.surettePool ??= createPool();
  return globalForDb.surettePool;
}

/**
 * Read replica pool (DATABASE_READ_URL) for heavy read-only work — analytics dashboards,
 * market series, exports. Falls back to the primary when no replica is configured.
 * Replicas lag slightly, so never read your own writes from here.
 */
export function getReadPool(): Pool {
  if (globalForDb.suretteReadPool === undefined) {
    const url = process.env.DATABASE_READ_URL;
    globalForDb.suretteReadPool = url ? createPool(url, "replica") : null;
  }
  return globalForDb.suretteReadPool ?? getPool();
}

/** Pool usage for metrics and readiness. */
export function poolStats() {
  const p = getPool();
  return { total: p.totalCount, idle: p.idleCount, waiting: p.waitingCount, max: p.options.max ?? 10 };
}

export type DbRole = "admin" | "agent" | "client" | "anonymous";

export interface DbContext {
  userId: string | null;
  role: DbRole;
  teamId: string | null;
}

export const ANONYMOUS: DbContext = { userId: null, role: "anonymous", teamId: null };

export interface Db {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<R[]>;
  one<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<R | null>;
}

function wrap(client: PoolClient): Db {
  return {
    async query<R extends QueryResultRow>(text: string, values?: unknown[]) {
      const result = await client.query<R>(text, values);
      return result.rows;
    },
    async one<R extends QueryResultRow>(text: string, values?: unknown[]): Promise<R | null> {
      const result = await client.query<R>(text, values);
      return (result.rows[0] as R | undefined) ?? null;
    },
  };
}

async function inTransaction<T>(setup: (client: PoolClient) => Promise<void>, fn: (db: Db) => Promise<T>, kind = "rls", pool = getPool()): Promise<T> {
  const client = await pool.connect();
  const started = performance.now();
  metrics.dbPool.set({ state: "total" }, pool.totalCount);
  metrics.dbPool.set({ state: "idle" }, pool.idleCount);
  metrics.dbPool.set({ state: "waiting" }, pool.waitingCount);
  try {
    await client.query("BEGIN");
    await setup(client);
    const result = await fn(wrap(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    metrics.dbQueryDuration.observe({ kind }, (performance.now() - started) / 1000);
  }
}

/** Run `fn` in one transaction as `surette_app`, with RLS applied for `context`. */
export function withDb<T>(context: DbContext, fn: (db: Db) => Promise<T>): Promise<T> {
  return inTransaction(async (client) => {
    await client.query("SET LOCAL ROLE surette_app");
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.role', $2, true), set_config('app.team_id', $3, true)",
      [context.userId ?? "", context.role, context.teamId ?? ""],
    );
  }, fn);
}

/** Run `fn` in one transaction as the owner role (bypasses RLS). Keep usage narrow. */
export function withSystemDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return inTransaction(async () => undefined, fn, "system");
}

/** Like withDb, but on the read replica (if configured) in a READ ONLY transaction. */
export function withReadDb<T>(context: DbContext, fn: (db: Db) => Promise<T>): Promise<T> {
  return inTransaction(
    async (client) => {
      await client.query("SET TRANSACTION READ ONLY");
      await client.query("SET LOCAL ROLE surette_app");
      await client.query(
        "SELECT set_config('app.user_id', $1, true), set_config('app.role', $2, true), set_config('app.team_id', $3, true)",
        [context.userId ?? "", context.role, context.teamId ?? ""],
      );
    },
    fn,
    "read",
    getReadPool(),
  );
}

/** Read-only system access on the replica (analytics aggregates, market data). */
export function withSystemReadDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  return inTransaction(async (client) => void (await client.query("SET TRANSACTION READ ONLY")), fn, "system_read", getReadPool());
}

/** True when the error is a Postgres constraint violation of the given SQLSTATE. */
export function isPgError(error: unknown, code: string): error is { code: string; constraint?: string; detail?: string } {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}

export const PG = {
  UNIQUE_VIOLATION: "23505",
  FOREIGN_KEY_VIOLATION: "23503",
  CHECK_VIOLATION: "23514",
  EXCLUSION_VIOLATION: "23P01",
  RLS_VIOLATION: "42501",
} as const;
