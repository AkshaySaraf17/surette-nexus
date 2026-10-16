import { clearedSessionCookie } from "@/lib/server/auth";
import { handler } from "@/lib/server/http";

export const POST = handler(async () => Response.json({ ok: true }, { headers: { "Set-Cookie": clearedSessionCookie() } }));
