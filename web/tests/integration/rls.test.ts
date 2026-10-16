import { afterAll, describe, expect, it } from "vitest";
import { utilityBillSchema } from "@/lib/validation";
import { ANONYMOUS, getPool, withDb, withSystemDb, type DbContext } from "@/lib/server/db";

/**
 * Row-Level Security against the real database (scripts/db.sh + npm run db:seed).
 * Proves the policies in database/migrations, independent of API-layer checks.
 */
async function ctx(email: string): Promise<DbContext> {
  const row = await withSystemDb((db) => db.one<{ id: string; role: DbContext["role"]; team_id: string }>("SELECT id, role, team_id FROM users WHERE email = $1", [email]));
  if (!row) throw new Error(`Seed user ${email} missing — run npm run db:seed`);
  return { userId: row.id, role: row.role, teamId: row.team_id };
}

describe("row-level security", () => {
  afterAll(() => getPool().end());

  it("anonymous visitors see published listings but no bills, collections or password hashes", async () => {
    const visible = await withDb(ANONYMOUS, (db) => db.query<{ status: string }>("SELECT status FROM properties"));
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((p) => ["active", "pending", "sold"].includes(p.status))).toBe(true);
    expect(await withDb(ANONYMOUS, (db) => db.query("SELECT 1 FROM utility_ledgers"))).toHaveLength(0);
    expect(await withDb(ANONYMOUS, (db) => db.query("SELECT 1 FROM collections"))).toHaveLength(0);
    await expect(withDb(ANONYMOUS, (db) => db.query("SELECT password_hash FROM users"))).rejects.toThrow(/permission denied/);
  });

  it("clients see only their own collections and can't edit listings", async () => {
    const client = await ctx("client@surette.test");
    const mine = await withDb(client, (db) => db.query<{ owner_id: string }>("SELECT owner_id FROM collections"));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((c) => c.owner_id === client.userId)).toBe(true);
    const updated = await withDb(client, (db) => db.query("UPDATE properties SET price_cents = 1 RETURNING id"));
    expect(updated).toHaveLength(0);
  });

  it("staff see their team's bills; a different team sees none", async () => {
    const admin = await ctx("owner@surette.test");
    const bills = await withDb(admin, (db) => db.query("SELECT amount_cents FROM utility_ledgers"));
    expect(bills.length).toBeGreaterThan(0);
    const outsider: DbContext = { ...admin, teamId: "00000000-0000-0000-0000-000000000000" };
    expect(await withDb(outsider, (db) => db.query("SELECT 1 FROM utility_ledgers"))).toHaveLength(0);
  });

  it("the API schema accepts only integer cents", () => {
    const base = { propertyId: "6f1c1b2e-6a43-4b7e-9d65-2f6d0f6b2c11", utility: "water", provider: "Kennebec Water District", periodStart: "2026-07-01", periodEnd: "2026-09-30" };
    expect(utilityBillSchema.safeParse({ ...base, amountCents: 41067 }).success).toBe(true);
    expect(utilityBillSchema.safeParse({ ...base, amountCents: 410.67 }).success).toBe(false);
    expect(utilityBillSchema.safeParse({ ...base, amountCents: 0 }).success).toBe(false);
  });

  it("the database rejects fractional or negative money", async () => {
    const admin = await ctx("owner@surette.test");
    const [property] = await withDb(admin, (db) => db.query<{ id: string }>("SELECT id FROM properties LIMIT 1"));
    await expect(
      withDb(admin, (db) =>
        db.query("INSERT INTO utility_ledgers (property_id, utility, provider, period_start, period_end, amount_cents) VALUES ($1, 'water', 'X', '2026-01-01', '2026-01-31', -5)", [property.id]),
      ),
    ).rejects.toThrow(/check constraint/);
    // A dollar amount sent where cents are expected is refused outright, not rounded.
    await expect(
      withDb(admin, (db) =>
        db.query("INSERT INTO utility_ledgers (property_id, utility, provider, period_start, period_end, amount_cents) VALUES ($1, 'water', 'X', '2026-01-01', '2026-01-31', $2)", [property.id, "410.67"]),
      ),
    ).rejects.toThrow(/invalid input syntax for type bigint/);
  });

  it("agents see only their own leads and deals; the owner sees the whole team", async () => {
    const owner = await ctx("owner@surette.test");
    const agent = await ctx("agent@surette.test");
    const allLeads = await withDb(owner, (db) => db.query("SELECT id FROM leads"));
    const agentLeads = await withDb(agent, (db) => db.query<{ assigned_agent_id: string | null }>("SELECT assigned_agent_id FROM leads"));
    expect(allLeads.length).toBeGreaterThan(agentLeads.length);
    expect(agentLeads.every((l) => l.assigned_agent_id === agent.userId)).toBe(true);
    const agentDeals = await withDb(agent, (db) => db.query<{ agent_id: string }>("SELECT agent_id FROM transactions"));
    expect(agentDeals.every((d) => d.agent_id === agent.userId)).toBe(true);
  });

  it("an agent can open a deal for themselves (INSERT … RETURNING) but not for someone else", async () => {
    const owner = await ctx("owner@surette.test");
    const agent = await ctx("agent@surette.test");
    const [row] = await withDb(agent, (db) =>
      db.query<{ id: string }>("INSERT INTO transactions (team_id, title, side, agent_id, client_name) VALUES ($1, 'RLS test deal', 'buyer', $2, 'Test') RETURNING id", [agent.teamId, agent.userId]),
    );
    expect(row.id).toBeTruthy();
    await expect(
      withDb(agent, (db) => db.query("INSERT INTO transactions (team_id, title, side, agent_id, client_name) VALUES ($1, 'Not mine', 'buyer', $2, 'Test')", [agent.teamId, owner.userId])),
    ).rejects.toThrow(/row-level security/);
    await withSystemDb((db) => db.query("DELETE FROM transactions WHERE id = $1", [row.id]));
  });

  it("clients can't see leads, and see only deals they are the client on", async () => {
    const client = await ctx("client@surette.test");
    expect(await withDb(client, (db) => db.query("SELECT 1 FROM leads"))).toHaveLength(0);
    const deals = await withDb(client, (db) => db.query<{ client_user_id: string }>("SELECT client_user_id FROM transactions"));
    expect(deals.every((d) => d.client_user_id === client.userId)).toBe(true);
  });

  it("the audit log is append-only", async () => {
    await expect(withSystemDb((db) => db.query("UPDATE audit_log SET action = action"))).rejects.toThrow();
  });
});
