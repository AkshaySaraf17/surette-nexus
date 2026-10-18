import { contextFor, requireStaff } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { MAX_DOCUMENT_BYTES, documentKey, extractCandidates, sniffType, storeDocument, deleteDocument } from "@/lib/server/documents";
import { ApiError, assertUuid, handler, notFound } from "@/lib/server/http";
import { multipartFingerprint, withIdempotency } from "@/lib/server/idempotency";
import { enqueueNow } from "@/lib/server/jobs";

/** POST /api/deals/:id/documents — multipart { file, label, extract? } (PDF, JPEG, PNG or text, ≤ 25 MB). */
export const POST = handler(async (request: Request, { params }: RouteContext<"/api/deals/[id]/documents">) => {
  const { id } = await params;
  assertUuid(id, "Deal");
  const viewer = await requireStaff(request);
  return withIdempotency(request, viewer.id, multipartFingerprint(request), async () => {
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > MAX_DOCUMENT_BYTES + 64 * 1024) throw new ApiError(413, "FILE_TOO_LARGE", "Documents can be up to 25 MB.");
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ApiError(400, "MALFORMED_MULTIPART", "Send the document as multipart/form-data.");
    }
    const file = form.get("file");
    const label = String(form.get("label") ?? "").trim().slice(0, 140);
    if (!(file instanceof File)) throw new ApiError(400, "VALIDATION_ERROR", "Choose a file.", { file: "Choose a file." });
    if (file.size === 0 || file.size > MAX_DOCUMENT_BYTES) throw new ApiError(413, "FILE_TOO_LARGE", "Documents can be up to 25 MB.", { file: "Up to 25 MB." });
    const buf = Buffer.from(await file.arrayBuffer());
    const mime = sniffType(buf);
    if (!mime) throw new ApiError(415, "UNSUPPORTED_FILE", "Only PDF, JPEG, PNG or plain-text documents are accepted.", { file: "PDF, JPEG, PNG or .txt only." });

    const ctx = contextFor(viewer);
    const exists = await withDb(ctx, (db) => db.one("SELECT 1 FROM transactions WHERE id = $1", [id]));
    if (!exists) throw notFound("Deal");
    const docId = crypto.randomUUID();
    const key = documentKey(id, docId);
    const sha256 = await storeDocument(key, buf);
    const wantsExtraction = form.get("extract") === "true";
    const extracted = wantsExtraction ? await extractCandidates(mime, buf) : [];
    try {
      await withDb(ctx, async (db) => {
        await db.query(
          `INSERT INTO transaction_documents (id, transaction_id, label, file_name, mime_type, bytes, sha256, storage_key, extracted, extraction_status, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::extraction_status, $11)`,
          [docId, id, label || file.name.slice(0, 140), file.name.replace(/[^\w.\- ]/g, "_").slice(0, 200), mime, buf.length, sha256, key, JSON.stringify(extracted), wantsExtraction ? "needs_review" : "not_extracted", viewer.id],
        );
        await db.query("INSERT INTO audit_log (team_id, actor_id, action, entity_type, entity_id, data) VALUES ($1, $2, 'document.uploaded', 'transaction', $3, $4)", [viewer.teamId, viewer.id, id, { documentId: docId, label, candidates: extracted.length }]);
      });
    } catch (error) {
      await deleteDocument(key);
      throw error;
    }
    // Make it searchable in "Ask the documents" within seconds (deduped: one pending index job at a time).
    await enqueueNow("ai.index", {}, { dedupeKey: "ai.index" }).catch(() => undefined);
    return Response.json({ id: docId, extracted }, { status: 201 });
  });
});
