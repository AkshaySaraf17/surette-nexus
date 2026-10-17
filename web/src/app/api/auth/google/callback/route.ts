import { connection } from "next/server";
import { contextFor, sessionCookie, signSession, verifyPurposeToken } from "@/lib/server/auth";
import { ensureDefaultCollection } from "@/lib/server/collections";
import { ApiError } from "@/lib/server/errors";
import { exchangeCode, googleConfig, signInWithGoogle, verifyIdToken } from "@/lib/server/google-oauth";
import { getSiteTeam } from "@/lib/server/listings";
import { childLogger } from "@/lib/server/logger";

const log = childLogger("google-oauth");

/** GET /api/auth/google/callback — Google sends the visitor back here with ?code&state. */
export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const site = url.origin;
  const clearOauth = "sn_oauth=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0";
  const fail = (code: string) => new Response(null, { status: 302, headers: [["Location", `${site}/sign-in?error=${code}`], ["Set-Cookie", clearOauth]] });

  const config = googleConfig();
  if (!config) return fail("google_off");
  if (url.searchParams.get("error")) return fail("google_cancelled"); // visitor closed or denied the Google prompt

  const cookie = (request.headers.get("cookie") ?? "").split(";").map((c) => c.trim()).find((c) => c.startsWith("sn_oauth="))?.slice("sn_oauth=".length);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!cookie || !code || !state) return fail("google_failed");

  try {
    const saved = await verifyPurposeToken("google_oauth", cookie);
    if (saved.state !== state) return fail("google_failed"); // CSRF / mixed-up tabs
    const idToken = await exchangeCode(config, code, String(saved.verifier));
    const identity = await verifyIdToken(idToken, config, String(saved.nonce));
    const team = await getSiteTeam();
    const { viewer, sessionVersion, created } = await signInWithGoogle(identity, team.id);
    if (created) await ensureDefaultCollection(contextFor(viewer), viewer);
    const session = await signSession(viewer.id, sessionVersion);
    const next = typeof saved.next === "string" && saved.next.startsWith("/") && !saved.next.startsWith("//") ? saved.next : "/account";
    return new Response(null, { status: 302, headers: [["Location", `${site}${next}`], ["Set-Cookie", sessionCookie(session)], ["Set-Cookie", clearOauth]] });
  } catch (error) {
    const codeName = error instanceof ApiError ? error.code.toLowerCase() : "google_failed";
    log.warn({ err: error instanceof Error ? error.message : String(error) }, "Google sign-in failed");
    return fail(codeName);
  }
}
