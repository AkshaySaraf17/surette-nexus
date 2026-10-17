import { connection } from "next/server";
import { signPurposeToken } from "@/lib/server/auth";
import { googleConfig, newAuthRequest } from "@/lib/server/google-oauth";

/** GET /api/auth/google/start?next=/account — begin "Continue with Google". */
export async function GET(request: Request) {
  await connection();
  const config = googleConfig();
  const site = new URL(request.url).origin;
  if (!config) return Response.redirect(`${site}/sign-in?error=google_off`, 302);
  const nextParam = new URL(request.url).searchParams.get("next") ?? "/account";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/account";
  const auth = newAuthRequest(config);
  // State, nonce and PKCE verifier travel in a signed, HttpOnly, 10-minute cookie scoped to the callback.
  const cookie = await signPurposeToken("google_oauth", { state: auth.state, nonce: auth.nonce, verifier: auth.verifier, next }, 600);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return new Response(null, {
    status: 302,
    headers: { Location: auth.url, "Set-Cookie": `sn_oauth=${cookie}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${secure}`, "Cache-Control": "no-store" },
  });
}
