import { z } from "zod";
import { contextFor, requireStaff } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { assertUuid, handler, notFound, parseBody } from "@/lib/server/http";
import { keyPrefixFromStorageKey, removeRenditions } from "@/lib/server/media";

const patchSchema = z.object({
  isCover: z.literal(true).optional(),
  altText: z.string().trim().max(300).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

/** PATCH /api/media/:id — make cover, edit alt text or reorder. */
export const PATCH = handler(async (request: Request, { params }: RouteContext<"/api/media/[id]">) => {
  const { id } = await params;
  assertUuid(id, "Photo");
  const viewer = await requireStaff(request);
  const input = await parseBody(request, patchSchema);
  await withDb(contextFor(viewer), async (db) => {
    const media = await db.one<{ property_id: string }>("SELECT property_id FROM media_assets WHERE id = $1", [id]);
    if (!media) throw notFound("Photo");
    if (input.isCover) {
      await db.query("UPDATE media_assets SET is_cover = false WHERE property_id = $1 AND is_cover", [media.property_id]);
      await db.query("UPDATE media_assets SET is_cover = true WHERE id = $1", [id]);
    }
    if (input.altText !== undefined) await db.query("UPDATE media_assets SET alt_text = $2 WHERE id = $1", [id, input.altText]);
    if (input.sortOrder !== undefined) await db.query("UPDATE media_assets SET sort_order = $2 WHERE id = $1", [id, input.sortOrder]);
  });
  return Response.json({ ok: true });
});

/** DELETE /api/media/:id — remove a photo and its files. */
export const DELETE = handler(async (request: Request, { params }: RouteContext<"/api/media/[id]">) => {
  const { id } = await params;
  assertUuid(id, "Photo");
  const viewer = await requireStaff(request);
  const key = await withDb(contextFor(viewer), async (db) => {
    const row = await db.one<{ storage_key: string }>("DELETE FROM media_assets WHERE id = $1 RETURNING storage_key", [id]);
    if (!row) throw notFound("Photo");
    return row.storage_key;
  });
  await removeRenditions(keyPrefixFromStorageKey(key));
  return new Response(null, { status: 204 });
});
