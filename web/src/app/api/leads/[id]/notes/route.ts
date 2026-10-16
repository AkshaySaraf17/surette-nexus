import { z } from "zod";
import { contextFor, requireStaff } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { assertUuid, handler, notFound, parseBody } from "@/lib/server/http";

const schema = z.object({ body: z.string().trim().min(1, "Write a note.").max(4000) });

export const POST = handler(async (request: Request, { params }: RouteContext<"/api/leads/[id]/notes">) => {
  const { id } = await params;
  assertUuid(id, "Lead");
  const viewer = await requireStaff(request);
  const input = await parseBody(request, schema);
  await withDb(contextFor(viewer), async (db) => {
    const lead = await db.one("SELECT 1 FROM leads WHERE id = $1", [id]);
    if (!lead) throw notFound("Lead");
    await db.query("INSERT INTO lead_notes (lead_id, author_id, body) VALUES ($1, $2, $3)", [id, viewer.id, input.body]);
  });
  return Response.json({ ok: true }, { status: 201 });
});
