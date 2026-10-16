import { z } from "zod";
import { contextFor, requireCustomer } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { handler, parseBody } from "@/lib/server/http";
import { ANALYTICS_CONSENT_VERSION, CONTACT_CONSENT_VERSION, PRIVACY_NOTICE_VERSION } from "@/lib/privacy";

const schema = z.object({ purpose: z.enum(["analytics", "marketing", "contact"]), granted: z.boolean() });
const VERSION = { analytics: ANALYTICS_CONSENT_VERSION, marketing: PRIVACY_NOTICE_VERSION, contact: CONTACT_CONSENT_VERSION } as const;

/** POST /api/account/consent — record a change of choice (append-only history). */
export const POST = handler(async (request: Request) => {
  const viewer = await requireCustomer(request);
  const input = await parseBody(request, schema);
  await withDb(contextFor(viewer), (db) =>
    db.query("INSERT INTO consent_records (team_id, user_id, purpose, granted, text_version) VALUES ($1, $2, $3::consent_purpose, $4, $5)", [viewer.teamId, viewer.id, input.purpose, input.granted, VERSION[input.purpose]]),
  );
  return Response.json({ ok: true });
});
