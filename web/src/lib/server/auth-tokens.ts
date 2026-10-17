import { createHash, randomBytes } from "node:crypto";
import type { Db } from "./db";
import { withSystemDb } from "./db";
import { ApiError } from "./errors";

/**
 * One-time links for password reset and email verification.
 * The raw token (32 random bytes) only ever exists in the email; the database keeps its
 * SHA-256. Tokens are single-use, expire, and issuing a new one cancels older ones.
 */
export type TokenPurpose = "password_reset" | "email_verify";
export const TOKEN_TTL_MS: Record<TokenPurpose, number> = { password_reset: 60 * 60_000, email_verify: 24 * 60 * 60_000 };

const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");

export async function issueToken(db: Db, userId: string, purpose: TokenPurpose): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await db.query("UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL", [userId, purpose]);
  await db.query(
    "INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval)",
    [userId, purpose, hash(raw), String(TOKEN_TTL_MS[purpose])],
  );
  return raw;
}

/** Mark the token used and return its user, or throw INVALID_LINK. Atomic: a token works once. */
export async function consumeToken(db: Db, raw: string, purpose: TokenPurpose): Promise<string> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(raw)) throw invalid();
  const row = await db.one<{ user_id: string }>(
    `UPDATE auth_tokens SET used_at = now()
      WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [hash(raw), purpose],
  );
  if (!row) throw invalid();
  return row.user_id;
}

function invalid() {
  return new ApiError(400, "INVALID_LINK", "This link is invalid, expired or already used. Request a new one.");
}

export function siteUrl(): string {
  return (process.env.PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");
}

export function purgeExpiredTokens() {
  return withSystemDb(async (db) => (await db.query("DELETE FROM auth_tokens WHERE expires_at < now() - interval '7 days' RETURNING 1")).length);
}
