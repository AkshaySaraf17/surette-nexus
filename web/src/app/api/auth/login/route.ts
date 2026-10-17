import { z } from "zod";
import { authenticate, sessionCookie, signSession } from "@/lib/server/auth";
import { handler, parseBody, rateLimit } from "@/lib/server/http";

const schema = z.object({
  email: z.email("Enter a valid email.").trim().toLowerCase(),
  password: z.string().min(1, "Enter your password."),
  // Which entrance is signing in: the customer site or the property-management portal / app.
  audience: z.enum(["customer", "staff", "any"]).default("any"),
});

/** POST /api/auth/login — sets the session cookie (web) and returns a bearer token (mobile). */
export const POST = handler(async (request: Request) => {
  await rateLimit(request, "login", 20, 15 * 60_000);
  const input = await parseBody(request, schema);
  const user = await authenticate(input.email, input.password, input.audience);
  const { sessionVersion, ...viewer } = user;
  const token = await signSession(user.id, sessionVersion);
  return Response.json({ token, user: viewer }, { headers: { "Set-Cookie": sessionCookie(token) } });
});
