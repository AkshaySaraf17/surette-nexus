import "server-only";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { Viewer, UserRole } from "@/lib/types";
import { ANONYMOUS, withSystemDb, type DbContext } from "./db";
import { ApiError } from "./errors";
import { currentContext } from "./request-context";

/**
 * Sessions: an HS256 JWT whose subject is the user id. The website keeps it in
 * an httpOnly cookie; the mobile app sends it as `Authorization: Bearer`.
 * The user row is re-read on every request, so role changes and deletions take
 * effect immediately.
 */
export const SESSION_COOKIE = "sn_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be set to a random string of at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** `sessionVersion` is bumped on password reset, which signs out every older session. */
export async function signSession(userId: string, sessionVersion = 1): Promise<string> {
  return new SignJWT({ sv: sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

/** Sign short-lived single-purpose data (e.g. a vendor-portal acknowledgement link). */
export async function signPurposeToken(purpose: string, payload: Record<string, string>, ttlSeconds: number): Promise<string> {
  return new SignJWT({ ...payload, purpose })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secretKey());
}

export async function verifyPurposeToken(purpose: string, token: string): Promise<Record<string, unknown>> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (payload.purpose !== purpose) throw new Error("wrong purpose");
    return payload as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "INVALID_LINK", "This link is invalid or has expired.");
  }
}

function tokenFromRequest(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim() || null;
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function viewerFromToken(token: string | null | undefined): Promise<Viewer | null> {
  if (!token) return null;
  let userId: string | undefined;
  let version = 1;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    userId = payload.sub;
    if (typeof payload.sv === "number") version = payload.sv;
  } catch {
    return null;
  }
  if (!userId) return null;
  const row = await withSystemDb((db) =>
    db.one<{ id: string; email: string; full_name: string; role: UserRole; team_id: string | null; assigned_agent_id: string | null; session_version: number; email_verified_at: Date | null }>(
      "SELECT id, email, full_name, role, team_id, assigned_agent_id, session_version, email_verified_at FROM users WHERE id = $1 AND is_active",
      [userId],
    ),
  );
  if (!row || row.session_version !== version) return null; // signed out by a password reset
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    teamId: row.team_id,
    assignedAgentId: row.assigned_agent_id,
    emailVerified: Boolean(row.email_verified_at),
  };
}

/** The signed-in user for an API request, or null. */
export async function getViewer(request: Request): Promise<Viewer | null> {
  const viewer = await viewerFromToken(tokenFromRequest(request));
  const ctx = currentContext();
  if (ctx && viewer) ctx.userId = viewer.id; // log lines and per-user rate limits
  return viewer;
}

/** The signed-in user for a Server Component (reads the session cookie). */
export async function getViewerFromCookies(): Promise<Viewer | null> {
  const store = await cookies();
  return viewerFromToken(store.get(SESSION_COOKIE)?.value);
}

export async function requireViewer(request: Request): Promise<Viewer> {
  const viewer = await getViewer(request);
  if (!viewer) throw new ApiError(401, "UNAUTHENTICATED", "Sign in to continue.");
  return viewer;
}

/** Admins and agents only (the operational portal and mobile app). */
export async function requireStaff(request: Request): Promise<Viewer & { teamId: string }> {
  const viewer = await requireViewer(request);
  if ((viewer.role !== "admin" && viewer.role !== "agent") || !viewer.teamId) {
    throw new ApiError(403, "FORBIDDEN", "Only team members can do this.");
  }
  return viewer as Viewer & { teamId: string };
}

export function contextFor(viewer: Viewer | null): DbContext {
  if (!viewer) return ANONYMOUS;
  return { userId: viewer.id, role: viewer.role, teamId: viewer.teamId };
}

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function isStaff(viewer: Viewer | null): viewer is Viewer & { teamId: string } {
  return Boolean(viewer && (viewer.role === "admin" || viewer.role === "agent") && viewer.teamId);
}

// ---------------------------------------------------------------------------
// Password sign-in with lockout. Two entrances share this: the customer sign-in
// (/sign-in) and the property-management sign-in (/portal/sign-in). Each rejects
// the other kind of account so people always land in the right workspace.
// ---------------------------------------------------------------------------

export type Audience = "customer" | "staff" | "any";

const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword(crypto.randomUUID()));

export async function authenticate(email: string, password: string, audience: Audience): Promise<Viewer & { sessionVersion: number }> {
  const row = await withSystemDb((db) =>
    db.one<{
      id: string;
      email: string;
      full_name: string;
      role: UserRole;
      team_id: string | null;
      assigned_agent_id: string | null;
      password_hash: string | null;
      is_active: boolean;
      locked_until: Date | null;
      session_version: number;
      email_verified_at: Date | null;
    }>(
      "SELECT id, email, full_name, role, team_id, assigned_agent_id, password_hash, is_active, locked_until, session_version, email_verified_at FROM users WHERE email = $1",
      [email],
    ),
  );
  // Always run bcrypt so timing doesn't reveal which emails exist. Google-only accounts have no
  // password; they get the same generic error (and can set one with "Forgot password").
  const ok = (await verifyPassword(password, row?.password_hash ?? (await getDummyHash()))) && Boolean(row?.password_hash);

  if (row?.locked_until && row.locked_until > new Date()) {
    const minutes = Math.ceil((row.locked_until.getTime() - Date.now()) / 60_000);
    throw new ApiError(429, "ACCOUNT_LOCKED", `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }
  if (!row || !ok) {
    if (row) {
      await withSystemDb((db) =>
        db.query(
          `UPDATE users SET failed_logins = failed_logins + 1,
                  locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE NULL END
            WHERE id = $1`,
          [row.id, MAX_FAILED_LOGINS, LOCK_MINUTES],
        ),
      );
    }
    throw new ApiError(401, "INVALID_CREDENTIALS", "That email and password don't match.");
  }
  if (!row.is_active) throw new ApiError(403, "ACCOUNT_DISABLED", "This account has been deactivated. Contact the office.");

  const staff = row.role === "admin" || row.role === "agent";
  if (audience === "customer" && staff) {
    throw new ApiError(403, "WRONG_PORTAL", "This is a team account. Use the property-management sign-in.", { email: "Team accounts sign in at /portal/sign-in." });
  }
  if (audience === "staff" && !staff) {
    throw new ApiError(403, "WRONG_PORTAL", "This is a customer account. Use the customer sign-in.", { email: "Customer accounts sign in at /sign-in." });
  }

  await withSystemDb((db) => db.query("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1", [row.id]));
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    teamId: row.team_id,
    assignedAgentId: row.assigned_agent_id,
    emailVerified: Boolean(row.email_verified_at),
    sessionVersion: row.session_version,
  };
}

/** Customers must confirm their email before saving data to their account. Staff are unaffected. */
export function assertEmailVerified(viewer: Viewer): void {
  if (viewer.role === "client" && !viewer.emailVerified) {
    throw new ApiError(403, "EMAIL_NOT_VERIFIED", "Confirm your email first — we sent you a link. You can resend it from your account page.");
  }
}

/** Owners/admins only. */
export async function requireAdmin(request: Request): Promise<Viewer & { teamId: string }> {
  const viewer = await requireStaff(request);
  if (viewer.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Only the owner or an administrator can do this.");
  return viewer;
}

/** Customers only (their personal workspace). */
export async function requireCustomer(request: Request): Promise<Viewer> {
  const viewer = await requireViewer(request);
  if (viewer.role !== "client") throw new ApiError(403, "FORBIDDEN", "This is available in customer accounts.");
  return viewer;
}
