import { contextFor, hashPassword, sessionCookie, signSession } from "@/lib/server/auth";
import { withSystemDb } from "@/lib/server/db";
import { ApiError, handler, parseBody, rateLimit } from "@/lib/server/http";
import { getSiteTeam } from "@/lib/server/listings";
import { ensureDefaultCollection } from "@/lib/server/collections";
import { issueToken, siteUrl } from "@/lib/server/auth-tokens";
import { queueEmail } from "@/lib/server/email";
import { verifyEmailMessage } from "@/lib/server/email-templates";
import { signupSchema } from "@/lib/validation";
import type { Viewer } from "@/lib/types";
import { PRIVACY_NOTICE_VERSION } from "@/lib/privacy";

/**
 * Client sign-up (for Collections and showing history). New clients join the
 * site's team and are assigned to the team leader until an admin reassigns them.
 * Staff accounts are created by admins in the portal, never here.
 *
 * The account starts unverified: a confirmation email is queued in the same transaction,
 * and saving homes/searches/plans unlocks once the link is clicked.
 */
export const POST = handler(async (request: Request) => {
  await rateLimit(request, "signup", 10, 60 * 60_000);
  const input = await parseBody(request, signupSchema);
  const team = await getSiteTeam();
  const passwordHash = await hashPassword(input.password);

  const viewer = await withSystemDb(async (db) => {
    const exists = await db.one("SELECT 1 FROM users WHERE email = $1", [input.email]);
    if (exists) throw new ApiError(409, "EMAIL_TAKEN", "An account with this email already exists.", { email: "Already registered. Sign in instead." });
    const leader = await db.one<{ id: string }>("SELECT id FROM users WHERE team_id = $1 AND is_leader LIMIT 1", [team.id]);
    const row = await db.one<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name, phone, role, team_id, assigned_agent_id)
       VALUES ($1, $2, $3, $4, 'client', $5, $6) RETURNING id`,
      [input.email, passwordHash, input.fullName, input.phone ?? null, team.id, leader?.id ?? null],
    );
    await db.query(
      "INSERT INTO consent_records (team_id, user_id, purpose, granted, text_version) VALUES ($1, $2, 'data_storage', true, $3)",
      [team.id, row!.id, PRIVACY_NOTICE_VERSION],
    );
    const raw = await issueToken(db, row!.id, "email_verify");
    await queueEmail(db, verifyEmailMessage(input.email, input.fullName, `${siteUrl()}/verify-email?token=${raw}`));
    const v: Viewer = {
      id: row!.id,
      email: input.email,
      fullName: input.fullName,
      role: "client",
      teamId: team.id,
      assignedAgentId: leader?.id ?? null,
      emailVerified: false,
    };
    return v;
  });

  await ensureDefaultCollection(contextFor(viewer), viewer);
  const token = await signSession(viewer.id);
  return Response.json({ token, user: viewer }, { status: 201, headers: { "Set-Cookie": sessionCookie(token) } });
});
