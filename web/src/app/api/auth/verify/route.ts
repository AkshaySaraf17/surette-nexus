import { consumeToken } from "@/lib/server/auth-tokens";
import { withSystemDb } from "@/lib/server/db";
import { handler, parseBody, rateLimit } from "@/lib/server/http";
import { verifyEmailSchema } from "@/lib/validation";

/** POST /api/auth/verify — confirm an email address with the link from the sign-up email. */
export const POST = handler(async (request: Request) => {
  await rateLimit(request, "verify-email", 20, 60 * 60_000);
  const { token } = await parseBody(request, verifyEmailSchema);
  await withSystemDb(async (db) => {
    const userId = await consumeToken(db, token, "email_verify");
    await db.query("UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1", [userId]);
  });
  return Response.json({ ok: true });
});
