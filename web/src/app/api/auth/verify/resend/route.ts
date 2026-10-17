import { requireCustomer } from "@/lib/server/auth";
import { issueToken, siteUrl } from "@/lib/server/auth-tokens";
import { withSystemDb } from "@/lib/server/db";
import { accountEmailsEnabled, queueEmail } from "@/lib/server/email";
import { verifyEmailMessage } from "@/lib/server/email-templates";
import { ApiError, handler, rateLimit } from "@/lib/server/http";

/** POST /api/auth/verify/resend — send a fresh confirmation link to the signed-in customer. */
export const POST = handler(async (request: Request) => {
  const viewer = await requireCustomer(request);
  await rateLimit(request, "verify-resend", 3, 60 * 60_000);
  if (viewer.emailVerified) return Response.json({ ok: true, alreadyVerified: true });
  if (!accountEmailsEnabled()) throw new ApiError(503, "EMAIL_OFF", "Email isn't available on this demo site. Contact the office.");
  await withSystemDb(async (db) => {
    const raw = await issueToken(db, viewer.id, "email_verify");
    await queueEmail(db, verifyEmailMessage(viewer.email, viewer.fullName, `${siteUrl()}/verify-email?token=${raw}`));
  });
  return Response.json({ ok: true });
});
