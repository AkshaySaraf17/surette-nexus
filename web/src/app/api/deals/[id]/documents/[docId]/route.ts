import { z } from "zod";
import { contextFor, requireStaff } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { deleteDocument, readDocument } from "@/lib/server/documents";
import { assertUuid, handler, notFound, parseBody } from "@/lib/server/http";
import { updateTransaction } from "@/lib/server/deals";

/** GET — download (always as an attachment; never rendered inline). Access re-checked on every request. */
export const GET = handler(async (request: Request, { params }: RouteContext<"/api/deals/[id]/documents/[docId]">) => {
  const { id, docId } = await params;
  assertUuid(id, "Deal");
  assertUuid(docId, "Document");
  const viewer = await requireStaff(request);
  const doc = await withDb(contextFor(viewer), (db) =>
    db.one<{ storage_key: string; mime_type: string; file_name: string }>("SELECT storage_key, mime_type, file_name FROM transaction_documents WHERE id = $1 AND transaction_id = $2", [docId, id]),
  );
  if (!doc) throw notFound("Document");
  const buf = await readDocument(doc.storage_key);
  if (!buf) throw notFound("Document file");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": doc.mime_type,
      "Content-Disposition": `attachment; filename="${doc.file_name.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
});

const reviewSchema = z.object({
  decision: z.enum(["verified", "rejected"]),
  // Fields the reviewer confirmed and wants copied onto the deal.
  apply: z.array(z.enum(["purchase_price", "closing_date", "effective_date"])).default([]),
});

/** PATCH — a person reviews extracted values; only verified values can be applied to the deal. */
export const PATCH = handler(async (request: Request, { params }: RouteContext<"/api/deals/[id]/documents/[docId]">) => {
  const { id, docId } = await params;
  assertUuid(id, "Deal");
  assertUuid(docId, "Document");
  const viewer = await requireStaff(request);
  const input = await parseBody(request, reviewSchema);
  const extracted = await withDb(contextFor(viewer), async (db) => {
    const doc = await db.one<{ extracted: { field: string; normalized: string | number }[] }>("SELECT extracted FROM transaction_documents WHERE id = $1 AND transaction_id = $2", [docId, id]);
    if (!doc) throw notFound("Document");
    await db.query("UPDATE transaction_documents SET extraction_status = $3::extraction_status, verified_by = $4, verified_at = now() WHERE id = $1 AND transaction_id = $2", [docId, id, input.decision, viewer.id]);
    await db.query("INSERT INTO audit_log (team_id, actor_id, action, entity_type, entity_id, data) VALUES ($1, $2, 'document.reviewed', 'transaction', $3, $4)", [viewer.teamId, viewer.id, id, { documentId: docId, decision: input.decision, applied: input.apply }]);
    return doc.extracted;
  });
  if (input.decision === "verified" && input.apply.length) {
    const value = (f: string) => extracted.find((e) => e.field === f)?.normalized;
    await updateTransaction(viewer, id, {
      ...(input.apply.includes("purchase_price") && typeof value("purchase_price") === "number" && { priceCents: value("purchase_price") as number }),
      ...(input.apply.includes("closing_date") && typeof value("closing_date") === "string" && { closingDate: value("closing_date") as string }),
      ...(input.apply.includes("effective_date") && typeof value("effective_date") === "string" && { contractDate: value("effective_date") as string }),
    });
  }
  return Response.json({ ok: true });
});

export const DELETE = handler(async (request: Request, { params }: RouteContext<"/api/deals/[id]/documents/[docId]">) => {
  const { id, docId } = await params;
  assertUuid(id, "Deal");
  assertUuid(docId, "Document");
  const viewer = await requireStaff(request);
  const key = await withDb(contextFor(viewer), async (db) => {
    const row = await db.one<{ storage_key: string }>("DELETE FROM transaction_documents WHERE id = $1 AND transaction_id = $2 RETURNING storage_key", [docId, id]);
    if (!row) throw notFound("Document");
    await db.query("INSERT INTO audit_log (team_id, actor_id, action, entity_type, entity_id, data) VALUES ($1, $2, 'document.deleted', 'transaction', $3, $4)", [viewer.teamId, viewer.id, id, { documentId: docId }]);
    return row.storage_key;
  });
  await deleteDocument(key);
  return new Response(null, { status: 204 });
});
