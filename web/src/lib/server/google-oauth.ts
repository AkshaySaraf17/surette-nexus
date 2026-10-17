import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Viewer } from "@/lib/types";
import { PRIVACY_NOTICE_VERSION } from "@/lib/privacy";
import { breaker } from "./circuit-breaker";
import { withSystemDb } from "./db";
import { ApiError } from "./errors";

/**
 * "Continue with Google" for customers (OpenID Connect, authorization-code flow with PKCE).
 *
 *   /api/auth/google/start     → creates state + nonce + PKCE verifier (kept in a short-lived signed
 *                                 cookie) and redirects to Google
 *   /api/auth/google/callback  → checks state, exchanges the code (with the verifier) for an ID
 *                                 token, verifies its signature, issuer, audience, expiry, nonce and
 *                                 that Google verified the email, then signs the customer in
 *
 * Accounts: an existing Google link signs in; otherwise a customer with the same (Google-verified)
 * email is linked; otherwise a new customer account is created. Team (staff) emails are refused —
 * staff always use the property-management sign-in.
 *
 * Enabled when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set (free: Google Cloud Console →
 * APIs & Services → Credentials → OAuth client ID → Web application; authorized redirect URI:
 * <PUBLIC_SITE_URL>/api/auth/google/callback).
 */
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authUrl: string;
  tokenUrl: string;
}

export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const site = (process.env.PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");
  return {
    clientId,
    clientSecret,
    redirectUri: `${site}/api/auth/google/callback`,
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
  };
}

const b64url = (buf: Buffer) => buf.toString("base64url");

export function newAuthRequest(config: GoogleConfig) {
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const url = new URL(config.authUrl);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { url: url.toString(), state, nonce, verifier };
}

export async function exchangeCode(config: GoogleConfig, code: string, verifier: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await breaker("google", { failureThreshold: 5, resetAfterMs: 60_000, timeoutMs: 10_000 }).exec((signal) =>
    fetchImpl(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: "authorization_code", code_verifier: verifier }),
      signal,
    }),
  );
  const data = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !data.id_token) throw new ApiError(400, "GOOGLE_FAILED", "Google sign-in didn't complete. Please try again.");
  return data.id_token;
}

let googleKeys: JWTVerifyGetKey | null = null;
const defaultKeys = () => (googleKeys ??= createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs")));

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
}

export async function verifyIdToken(idToken: string, config: Pick<GoogleConfig, "clientId">, nonce: string, keys: JWTVerifyGetKey = defaultKeys()): Promise<GoogleIdentity> {
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, keys, { issuer: GOOGLE_ISSUERS, audience: config.clientId, clockTolerance: 30 }));
  } catch {
    throw new ApiError(400, "GOOGLE_FAILED", "Google sign-in couldn't be verified. Please try again.");
  }
  if (payload.nonce !== nonce) throw new ApiError(400, "GOOGLE_FAILED", "Google sign-in couldn't be verified. Please try again.");
  if (payload.email_verified !== true || typeof payload.email !== "string" || typeof payload.sub !== "string") {
    throw new ApiError(400, "GOOGLE_EMAIL_UNVERIFIED", "Your Google account's email isn't verified, so it can't be used here.");
  }
  const name = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim().slice(0, 120) : payload.email.split("@")[0];
  return { sub: payload.sub, email: payload.email.toLowerCase(), name };
}

/** Find, link or create the customer for a verified Google identity. */
export async function signInWithGoogle(identity: GoogleIdentity, teamId: string): Promise<{ viewer: Viewer; sessionVersion: number; created: boolean }> {
  return withSystemDb(async (db) => {
    type Row = { id: string; email: string; full_name: string; role: Viewer["role"]; team_id: string | null; assigned_agent_id: string | null; is_active: boolean; session_version: number; google_sub: string | null };
    const cols = "id, email, full_name, role, team_id, assigned_agent_id, is_active, session_version, google_sub";
    let row = await db.one<Row>(`SELECT ${cols} FROM users WHERE google_sub = $1`, [identity.sub]);
    let created = false;
    if (!row) {
      row = await db.one<Row>(`SELECT ${cols} FROM users WHERE email = $1`, [identity.email]);
      if (row && row.role !== "client") throw new ApiError(403, "WRONG_PORTAL", "This is a team account. Use the property-management sign-in.");
      if (row) {
        if (row.google_sub && row.google_sub !== identity.sub) throw new ApiError(409, "GOOGLE_MISMATCH", "This email is already linked to a different Google account.");
        await db.query("UPDATE users SET google_sub = $2, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1", [row.id, identity.sub]);
      } else {
        const leader = await db.one<{ id: string }>("SELECT id FROM users WHERE team_id = $1 AND is_leader LIMIT 1", [teamId]);
        row = await db.one<Row>(
          `INSERT INTO users (email, password_hash, google_sub, full_name, role, team_id, assigned_agent_id, email_verified_at)
           VALUES ($1, NULL, $2, $3, 'client', $4, $5, now()) RETURNING ${cols}`,
          [identity.email, identity.sub, identity.name, teamId, leader?.id ?? null],
        );
        await db.query("INSERT INTO consent_records (team_id, user_id, purpose, granted, text_version) VALUES ($1, $2, 'data_storage', true, $3)", [teamId, row!.id, PRIVACY_NOTICE_VERSION]);
        created = true;
      }
    }
    if (!row!.is_active) throw new ApiError(403, "ACCOUNT_DISABLED", "This account has been deactivated. Contact the office.");
    if (row!.role !== "client") throw new ApiError(403, "WRONG_PORTAL", "This is a team account. Use the property-management sign-in.");
    await db.query("UPDATE users SET last_login_at = now(), failed_logins = 0, locked_until = NULL WHERE id = $1", [row!.id]);
    return {
      viewer: { id: row!.id, email: row!.email, fullName: row!.full_name, role: row!.role, teamId: row!.team_id, assignedAgentId: row!.assigned_agent_id, emailVerified: true },
      sessionVersion: row!.session_version,
      created,
    };
  });
}
