import { issueToken, siteUrl } from "@/lib/server/auth-tokens";
import { withSystemDb } from "@/lib/server/db";
import { accountEmailsEnabled, EMAIL_OFF_MESSAGE, queueEmail } from "@/lib/server/email";
import { passwordResetMessage } from "@/lib/server/email-templates";
import { ApiError, handler, parseBody, rateLimit } from "@/lib/server/http";
import { hit } from "@/lib/server/limiter";
import { forgotPasswordSchema } from "@/lib/validation";

/**
 * POST /api/auth/password/forgot — email a one-time reset link to a customer.
 * Always answers the same way, whether or not the email has an account, so the form can't be
 * used to discover who's registered. Team accounts are reset by the owner in Portal → Team.
 */
export const POST = handler(async (request: Request) => {
  // Same answer for every email, so this reveals nothing about who has an account.
  if (!accountEmailsEnabled()) throw new ApiError(503, "EMAIL_OFF", EMAIL_OFF_MESSAGE);
  await rateLimit(request, "password-forgot", 5, 60 * 60_000);
  const { email } = await parseBody(request, forgotPasswordSchema);
  // At most 3 emails per address per hour. Over the limit we quietly skip sending (a 429 here
  // would reveal that the address exists).
  const perEmail = await hit("password-forgot-email", email, 3, 60 * 60_000);
  if (perEmail.allowed) await withSystemDb(async (db) => {
    const user = await db.one<{ id: string; full_name: string }>("SELECT id, full_name FROM users WHERE email = $1 AND role = 'client' AND is_active", [email]);
    if (!user) return;
    const raw = await issueToken(db, user.id, "password_reset");
    await queueEmail(db, passwordResetMessage(email, user.full_name, `${siteUrl()}/reset-password?token=${raw}`));
  });
  return Response.json({ ok: true, message: "If an account exists for that email, we've sent a link to reset the password. It works for 1 hour." });
});
