import { afterAll, describe, expect, it } from "vitest";
import { consumeToken, issueToken } from "@/lib/server/auth-tokens";
import { getPool, withSystemDb } from "@/lib/server/db";
import { signInWithGoogle } from "@/lib/server/google-oauth";
import { siteTeamId, testTag } from "../helpers/db";

/** One-time tokens and Google account linking against the real database. */
const tag = testTag("auth");
afterAll(async () => {
  await withSystemDb((db) => db.query("DELETE FROM users WHERE email LIKE $1", [`${tag}%`]));
  await getPool().end();
});

async function makeCustomer(email: string) {
  const teamId = await siteTeamId();
  return (await withSystemDb((db) =>
    db.one<{ id: string }>("INSERT INTO users (email, password_hash, full_name, role, team_id) VALUES ($1, 'x', 'Test Person', 'client', $2) RETURNING id", [email, teamId]),
  ))!.id;
}

describe("one-time tokens", () => {
  it("work once, only for their purpose, and a new one cancels the old", async () => {
    const userId = await makeCustomer(`${tag}-t@example.com`);
    const first = await withSystemDb((db) => issueToken(db, userId, "password_reset"));
    const second = await withSystemDb((db) => issueToken(db, userId, "password_reset"));
    await expect(withSystemDb((db) => consumeToken(db, first, "password_reset"))).rejects.toMatchObject({ code: "INVALID_LINK" });
    await expect(withSystemDb((db) => consumeToken(db, second, "email_verify"))).rejects.toMatchObject({ code: "INVALID_LINK" });
    await expect(withSystemDb((db) => consumeToken(db, second, "password_reset"))).resolves.toBe(userId);
    await expect(withSystemDb((db) => consumeToken(db, second, "password_reset"))).rejects.toMatchObject({ code: "INVALID_LINK" });
  });
  it("expire", async () => {
    const userId = await makeCustomer(`${tag}-e@example.com`);
    const raw = await withSystemDb((db) => issueToken(db, userId, "email_verify"));
    await withSystemDb((db) => db.query("UPDATE auth_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [userId]));
    await expect(withSystemDb((db) => consumeToken(db, raw, "email_verify"))).rejects.toMatchObject({ code: "INVALID_LINK" });
  });
  it("only a hash is stored", async () => {
    const userId = await makeCustomer(`${tag}-h@example.com`);
    const raw = await withSystemDb((db) => issueToken(db, userId, "email_verify"));
    const rows = await withSystemDb((db) => db.query<{ token_hash: string }>("SELECT token_hash FROM auth_tokens WHERE user_id = $1", [userId]));
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].token_hash).not.toContain(raw);
  });
});

describe("Google account linking", () => {
  it("creates a verified customer with no password for a new Google user", async () => {
    const teamId = await siteTeamId();
    const r = await signInWithGoogle({ sub: `${tag}-g1`, email: `${tag}-new@example.com`, name: "New Google" }, teamId);
    expect(r.created).toBe(true);
    expect(r.viewer.role).toBe("client");
    const row = await withSystemDb((db) => db.one<{ password_hash: string | null; email_verified_at: Date | null }>("SELECT password_hash, email_verified_at FROM users WHERE id = $1", [r.viewer.id]));
    expect(row!.password_hash).toBeNull();
    expect(row!.email_verified_at).not.toBeNull();
    const again = await signInWithGoogle({ sub: `${tag}-g1`, email: `${tag}-new@example.com`, name: "New Google" }, teamId);
    expect(again.created).toBe(false);
    expect(again.viewer.id).toBe(r.viewer.id);
  });
  it("links an existing customer with the same email", async () => {
    const teamId = await siteTeamId();
    const id = await makeCustomer(`${tag}-link@example.com`);
    const r = await signInWithGoogle({ sub: `${tag}-g2`, email: `${tag}-link@example.com`, name: "X" }, teamId);
    expect(r.viewer.id).toBe(id);
    expect(r.created).toBe(false);
  });
  it("refuses team (staff) emails and a second Google account for the same email", async () => {
    const teamId = await siteTeamId();
    await expect(signInWithGoogle({ sub: `${tag}-g3`, email: "agent@surette.test", name: "X" }, teamId)).rejects.toMatchObject({ code: "WRONG_PORTAL" });
    await expect(signInWithGoogle({ sub: `${tag}-other`, email: `${tag}-link@example.com`, name: "X" }, teamId)).rejects.toMatchObject({ code: "GOOGLE_MISMATCH" });
  });
});
