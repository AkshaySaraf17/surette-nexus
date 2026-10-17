import { hashPassword, sessionCookie, signSession } from "@/lib/server/auth";
import { consumeToken } from "@/lib/server/auth-tokens";
import { withSystemDb } from "@/lib/server/db";
import { handler, parseBody, rateLimit } from "@/lib/server/http";
import { resetPasswordSchema } from "@/lib/validation";

/**
 * POST /api/auth/password/reset — set a new password with a one-time link.
 * Signs out every other session (session_version bump), clears any lockout, marks the email
 * verified (the person just proved they receive it) and signs this browser in.
 */
export const POST = handler(async (request: Request) => {
  await rateLimit(request, "password-reset", 10, 60 * 60_000);
  const { token, password } = await parseBody(request, resetPasswordSchema);
  const passwordHash = await hashPassword(password);
  const user = await withSystemDb(async (db) => {
    const userId = await consumeToken(db, token, "password_reset");
    await db.query("UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND purpose = 'password_reset' AND used_at IS NULL", [userId]);
    return db.one<{ id: string; session_version: number }>(
      `UPDATE users SET password_hash = $2, session_version = session_version + 1, failed_logins = 0, locked_until = NULL,
              email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
        WHERE id = $1 AND is_active RETURNING id, session_version`,
      [userId, passwordHash],
    );
  });
  const session = await signSession(user!.id, user!.session_version);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(session) } });
});
