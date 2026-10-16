import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import Busboy from "busboy";
import { after } from "next/server";
import { contextFor, requireStaff } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { ApiError, handler, validate } from "@/lib/server/http";
import { multipartFingerprint, withIdempotency } from "@/lib/server/idempotency";
import { getListingById } from "@/lib/server/listings";
import { createListing, updateListing } from "@/lib/server/listing-writes";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  processImageStream,
  relocate,
  removeDir,
  removeRenditions,
  type ProcessedImage,
} from "@/lib/server/media";
import { emitWebhook } from "@/lib/server/webhooks";
import { listingInputSchema, listingPatchSchema } from "@/lib/validation";

/**
 * POST /api/properties/upload — the ingestion pipeline used by the mobile app
 * and the admin portal.
 *
 * multipart/form-data fields (any order):
 *   propertyId   optional — add photos to (and optionally patch) an existing listing
 *   metadata     JSON listing fields; required when creating a listing
 *   alts         optional JSON array of alt texts, aligned with the files
 *   coverIndex   optional index of the file to make the cover photo
 *   files        one or more images (JPEG/PNG/WebP/AVIF/HEIC), ≤ 30 MB each, ≤ 40 per request
 *
 * Each file is streamed through sharp as it arrives (never buffered whole) into
 * WebP renditions under a staging prefix. Once the body is fully read, ONE
 * database transaction creates/updates the listing and inserts the media rows;
 * only then are the files moved to their final keys. The commit fires the
 * Postgres NOTIFY trigger, so every open browser re-renders with the new photos
 * within a second — no page reload. Any failure removes the written files.
 */

const MAX_FILES = 40;

export const POST = handler(async (request: Request) => {
  const viewer = await requireStaff(request);
  return withIdempotency(request, viewer.id, multipartFingerprint(request), async () => {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the listing as multipart/form-data.");
    }
    if (!request.body) throw new ApiError(400, "EMPTY_BODY", "The request has no body.");

    const uploadId = crypto.randomUUID();
    const stagingDir = `staging/${uploadId}`;
    const fields = new Map<string, string>();
    const staged: { assetId: string; prefix: string; image: ProcessedImage; originalName: string }[] = [];

    try {
      await new Promise<void>((resolve, reject) => {
        let busboy: Busboy.Busboy;
        try {
          busboy = Busboy({
            headers: { "content-type": contentType },
            limits: { files: MAX_FILES, fileSize: MAX_IMAGE_BYTES, fields: 20, fieldSize: 256 * 1024 },
          });
        } catch {
          reject(new ApiError(400, "MALFORMED_MULTIPART", "The multipart body could not be read."));
          return;
        }
        const jobs: Promise<void>[] = [];
        let failed = false;
        const fail = (error: unknown) => {
          if (failed) return;
          failed = true;
          reject(error);
        };

        busboy.on("field", (name, value, info) => {
          if (info.valueTruncated) fail(new ApiError(413, "FIELD_TOO_LARGE", `The ${name} field is too large.`));
          else fields.set(name, value);
        });

        busboy.on("file", (name, stream, info) => {
          if (name !== "files" && name !== "files[]") {
            stream.resume();
            return;
          }
          if (!ACCEPTED_IMAGE_TYPES.includes(info.mimeType.toLowerCase())) {
            stream.resume();
            fail(new ApiError(415, "UNSUPPORTED_FILE", `${info.filename || "A file"} isn't a supported image (JPEG, PNG, WebP, AVIF or HEIC).`));
            return;
          }
          const assetId = crypto.randomUUID();
          const prefix = `${stagingDir}/${assetId}`;
          const index = jobs.length;
          let truncated = false;
          stream.on("limit", () => {
            truncated = true;
            stream.destroy(new ApiError(413, "FILE_TOO_LARGE", `${info.filename || "A photo"} is larger than 30 MB.`));
          });
          jobs.push(
            processImageStream(stream, prefix)
              .then((image) => {
                if (truncated) throw new ApiError(413, "FILE_TOO_LARGE", `${info.filename || "A photo"} is larger than 30 MB.`);
                staged[index] = { assetId, prefix, image, originalName: info.filename || `photo-${index + 1}` };
              })
              .catch((error: unknown) => {
                fail(
                  error instanceof ApiError
                    ? error
                    : new ApiError(422, "UNREADABLE_IMAGE", `${info.filename || "A photo"} couldn't be processed. Is it a valid image?`),
                );
              }),
          );
        });

        busboy.on("filesLimit", () => fail(new ApiError(413, "TOO_MANY_FILES", `Upload at most ${MAX_FILES} photos at a time.`)));
        busboy.on("error", () => fail(new ApiError(400, "MALFORMED_MULTIPART", "The multipart body could not be read.")));
        busboy.on("close", () => {
          Promise.all(jobs).then(() => !failed && resolve(), fail);
        });

        const body = Readable.fromWeb(request.body as unknown as NodeReadableStream<Uint8Array>);
        body.on("error", () => fail(new ApiError(400, "UPLOAD_ABORTED", "The upload was interrupted.")));
        body.pipe(busboy);
      });

      const images = staged.filter(Boolean);
      const propertyIdField = fields.get("propertyId")?.trim() || null;
      const metadataRaw = fields.get("metadata");
      let metadata: unknown = undefined;
      if (metadataRaw) {
        try {
          metadata = JSON.parse(metadataRaw);
        } catch {
          throw new ApiError(400, "INVALID_JSON", "The metadata field must be valid JSON.");
        }
      }
      let alts: string[] = [];
      if (fields.get("alts")) {
        try {
          const parsed = JSON.parse(fields.get("alts")!);
          if (Array.isArray(parsed)) alts = parsed.map((a) => String(a ?? "").slice(0, 300));
        } catch {
          throw new ApiError(400, "INVALID_JSON", "The alts field must be a JSON array.");
        }
      }
      const coverIndexRaw = fields.get("coverIndex");
      const coverIndex = coverIndexRaw !== undefined && /^\d+$/.test(coverIndexRaw) ? Number(coverIndexRaw) : null;

      if (!propertyIdField && metadata === undefined) {
        throw new ApiError(400, "VALIDATION_ERROR", "Listing details are required for a new listing.", { metadata: "Required." });
      }
      if (propertyIdField && !/^[0-9a-f-]{36}$/i.test(propertyIdField)) {
        throw new ApiError(400, "VALIDATION_ERROR", "propertyId must be a UUID.", { propertyId: "Invalid id." });
      }
      if (!propertyIdField && images.length === 0) {
        throw new ApiError(422, "PHOTOS_REQUIRED", "Add at least one photo to create a listing.", { files: "Add at least one photo." });
      }

      // One transaction: listing row + media rows. Files move into place only after it commits.
      const context = contextFor(viewer);
      const finalPrefix = (propertyId: string, assetId: string) => `listings/${propertyId}/${assetId}`;
      const result = await withDb(context, async (db) => {
        let propertyId: string;
        let published = false;
        if (propertyIdField) {
          const patch = metadata === undefined ? {} : validate(listingPatchSchema, metadata);
          const updated = await updateListing(db, propertyIdField, patch);
          propertyId = updated.id;
          published = updated.published;
        } else {
          const input = validate(listingInputSchema, metadata);
          const created = await createListing(db, viewer, input);
          propertyId = created.id;
          published = created.published;
        }

        const existing = await db.one<{ max: number | null; has_cover: boolean }>(
          "SELECT max(sort_order) AS max, bool_or(is_cover) AS has_cover FROM media_assets WHERE property_id = $1",
          [propertyId],
        );
        let sort = (existing?.max ?? -1) + 1;
        const makeCover = coverIndex ?? (existing?.has_cover ? null : 0);
        if (makeCover !== null && images[makeCover]) {
          await db.query("UPDATE media_assets SET is_cover = false WHERE property_id = $1 AND is_cover", [propertyId]);
        }
        for (const [i, item] of images.entries()) {
          const prefix = finalPrefix(propertyId, item.assetId);
          // Move the files while still inside the transaction: if anything later throws, nothing
          // commits and the catch block below deletes them from their new location.
          const moved = await relocate(item.image, item.prefix, prefix);
          item.prefix = prefix;
          await db.query(
            `INSERT INTO media_assets (id, property_id, kind, url, storage_key, variants, width, height, bytes, blur_data_url,
                                       alt_text, sort_order, is_cover, original_name, uploaded_by)
             VALUES ($1, $2, 'image', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
              item.assetId,
              propertyId,
              moved.url,
              moved.storageKey,
              moved.variants,
              moved.width,
              moved.height,
              moved.bytes,
              moved.blurDataUrl,
              alts[i] ?? "",
              sort++,
              makeCover === i,
              item.originalName.slice(0, 200),
              viewer.id,
            ],
          );
        }
        return { propertyId, published };
      });
      await removeDir(stagingDir);

      const listing = await getListingById(context, result.propertyId);
      after(async () => {
        if (images.length) {
          await emitWebhook(viewer.teamId, "media.uploaded", { propertyId: result.propertyId, count: images.length, uploadedBy: viewer.id });
        }
        if (result.published && listing) {
          await emitWebhook(viewer.teamId, "listing.published", { propertyId: listing.id, slug: listing.slug, title: listing.title });
        } else if (listing) {
          await emitWebhook(viewer.teamId, "listing.updated", { propertyId: listing.id, slug: listing.slug });
        }
      });

      return Response.json({ property: listing, uploaded: images.length }, { status: propertyIdField ? 200 : 201 });
    } catch (error) {
      await Promise.all(staged.filter(Boolean).map((s) => removeRenditions(s.prefix)));
      await removeDir(stagingDir);
      throw error;
    }
  });
});
