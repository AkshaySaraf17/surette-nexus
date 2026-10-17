import { connection } from "next/server";
import { googleConfig } from "@/lib/server/google-oauth";

/** GET /api/auth/providers — which sign-in options are switched on (for the sign-in page). */
export async function GET() {
  await connection();
  return Response.json({ google: Boolean(googleConfig()) });
}
