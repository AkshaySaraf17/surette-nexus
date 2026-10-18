import { Pool } from "pg";

try {
  process.loadEnvFile(".env");
} catch {
  // CI may provide DATABASE_URL directly.
}

let pool: Pool | null = null;
export function db() {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  return pool;
}
export async function closeDb() {
  await pool?.end();
  pool = null;
}

/** Events stored for one SDK session id (read with the system role — tests only). */
export async function eventsForSession(sessionId: string) {
  const { rows } = await db().query<{ type: string; data_class: string; project_key: string; props: Record<string, unknown> }>(
    "SELECT type, data_class, project_key, props FROM analytics_events WHERE session_id = $1 ORDER BY occurred_at",
    [sessionId],
  );
  return rows;
}

export async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  let last = await fn();
  while (!ok(last) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 250));
    last = await fn();
  }
  return last;
}

export const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";

/**
 * A separate client address for a spec file (use with test.use({ extraHTTPHeaders })), so its sign-ins
 * don't use up the per-address login limit (20 per 15 min) shared by the rest of the suite.
 */
export const ownClientIp = (subnet: number) => ({ "X-Real-IP": `10.${subnet}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
export const ACCOUNTS = {
  owner: { email: "owner@surette.test", password: "surette-owner-2026", audience: "staff" },
  agent: { email: "agent@surette.test", password: "surette-agent-2026", audience: "staff" },
  client: { email: "client@surette.test", password: "surette-client-2026", audience: "customer" },
} as const;

/** Sign in through the API (sets the session cookie on this request context / page). */
export async function signIn(request: import("@playwright/test").APIRequestContext, who: keyof typeof ACCOUNTS) {
  const res = await request.post("/api/auth/login", { data: ACCOUNTS[who], headers: { Origin: BASE } });
  if (!res.ok()) throw new Error(`sign-in as ${who} failed: ${res.status()}`);
}
