import "server-only";
import { createHash } from "node:crypto";
import { withSystemDb } from "./db";
import { documentPages, readDocument } from "./documents";
import { childLogger } from "./logger";
import { chunkPages, embed, mlConfigured, toVector } from "./ml-client";

/**
 * Keeps the vector index (pgvector) in step with documents and listings. Runs in the worker as the
 * `ai.index` job: every few minutes, and right after a document upload.
 *
 * - Documents: text by page → chunks (with page numbers) → embeddings → document_chunks.
 * - Listings: summary + description chunks + features → embeddings → property_chunks. A content
 *   hash means only listings whose text changed are re-embedded.
 *
 * Embedding model: OLLAMA_EMBED_MODEL (default mxbai-embed-large, chosen by the evaluation in ml/eval). Changing it changes the hash, so
 * everything is re-embedded with the new model automatically.
 */
const log = childLogger("ai-index");
const MODEL = () => process.env.OLLAMA_EMBED_MODEL?.trim() || "mxbai-embed-large";
const BATCH = 20;

interface PropertyRow {
  id: string;
  title: string;
  headline: string | null;
  description: string;
  city: string;
  property_type: string;
  listing_type: string;
  bedrooms: number;
  full_baths: number;
  half_baths: number;
  living_area_sqft: number | null;
  lot_size_sqft: number | null;
  year_built: number | null;
  amenities: string[];
  structural_features: Record<string, string>;
  school_district: string | null;
  ai_content_hash: string | null;
}

/** The listing's searchable text as separate pieces (each becomes one or more chunks). */
export function listingTexts(p: PropertyRow): { summary: string; description: string; extras: string[] } {
  const baths = p.full_baths + p.half_baths / 2;
  const facts = [
    `${p.property_type.replace(/_/g, " ")} for ${p.listing_type === "rent" ? "rent" : "sale"} in ${p.city}, Maine`,
    p.bedrooms ? `${p.bedrooms} bedrooms` : null,
    baths ? `${baths} bathrooms` : null,
    p.living_area_sqft ? `${p.living_area_sqft.toLocaleString("en-US")} square feet` : null,
    p.lot_size_sqft ? `${(p.lot_size_sqft / 43_560).toFixed(2)} acre lot` : null,
    p.year_built ? `built ${p.year_built}` : null,
  ].filter(Boolean);
  const extras = [
    p.amenities.length ? `Features: ${p.amenities.join(", ")}.` : "",
    Object.keys(p.structural_features).length ? `Construction: ${Object.entries(p.structural_features).map(([k, v]) => `${k}: ${v}`).join("; ")}.` : "",
    p.school_district ? `School district: ${p.school_district}.` : "",
  ].filter(Boolean);
  return { summary: `${p.title}. ${p.headline ? `${p.headline}. ` : ""}${facts.join(", ")}.`, description: p.description.trim(), extras };
}

export function contentHash(p: PropertyRow, model = MODEL()): string {
  const t = listingTexts(p);
  return createHash("sha256").update(JSON.stringify([model, t.summary, t.description, t.extras])).digest("hex");
}

async function indexProperties(): Promise<number> {
  const rows = await withSystemDb((db) =>
    db.query<PropertyRow>(
      `SELECT id, title, headline, description, city, property_type, listing_type, bedrooms, full_baths, half_baths,
              living_area_sqft, lot_size_sqft, year_built, amenities, structural_features, school_district, ai_content_hash
         FROM properties ORDER BY updated_at DESC`,
    ),
  );
  const stale = rows.filter((p) => p.ai_content_hash !== contentHash(p)).slice(0, BATCH);
  for (const p of stale) {
    const t = listingTexts(p);
    const descChunks = t.description ? (await chunkPages([{ page: 1, text: t.description }], 120, 20)).map((c) => c.text) : [];
    const texts = [t.summary, ...descChunks, ...t.extras];
    const vectors = await embed(texts, "document");
    const hash = contentHash(p);
    // One transaction (withSystemDb): readers never see a half-replaced set of chunks.
    await withSystemDb(async (db) => {
      // Two index runs at once (schedule + upload) take turns per item instead of colliding.
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [p.id]);
      await db.query("DELETE FROM property_chunks WHERE property_id = $1", [p.id]);
      for (let i = 0; i < texts.length; i++) {
        await db.query("INSERT INTO property_chunks (property_id, ord, content, embedding, model) VALUES ($1, $2, $3, $4::vector, $5)", [p.id, i, texts[i].slice(0, 4000), toVector(vectors[i]), MODEL()]);
      }
      await db.query("UPDATE properties SET ai_content_hash = $2, ai_indexed_at = now() WHERE id = $1", [p.id, hash]);
    });
  }
  return stale.length;
}

async function indexDocuments(): Promise<number> {
  const docs = await withSystemDb((db) =>
    db.query<{ id: string; transaction_id: string; mime_type: string; storage_key: string }>(
      "SELECT id, transaction_id, mime_type, storage_key FROM transaction_documents WHERE ai_indexed_at IS NULL AND ai_index_error IS NULL ORDER BY created_at LIMIT $1",
      [BATCH],
    ),
  );
  for (const d of docs) {
    const buf = await readDocument(d.storage_key);
    const pages = buf ? await documentPages(d.mime_type, buf) : [];
    const chunks = pages.some((p) => p.text.trim()) ? await chunkPages(pages) : [];
    if (!chunks.length) {
      // Scanned images or empty files: nothing to search (no OCR yet). Recorded so it isn't retried forever.
      await withSystemDb((db) => db.query("UPDATE transaction_documents SET ai_index_error = $2 WHERE id = $1", [d.id, buf ? "no_text" : "file_missing"]));
      continue;
    }
    const vectors = await embed(chunks.map((c) => c.text), "document");
    await withSystemDb(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [d.id]);
      await db.query("DELETE FROM document_chunks WHERE document_id = $1", [d.id]);
      for (let i = 0; i < chunks.length; i++) {
        await db.query(
          "INSERT INTO document_chunks (document_id, transaction_id, page, ord, content, embedding, model) VALUES ($1, $2, $3, $4, $5, $6::vector, $7)",
          [d.id, d.transaction_id, chunks[i].page, i, chunks[i].text.slice(0, 4000), toVector(vectors[i]), MODEL()],
        );
      }
      await db.query("UPDATE transaction_documents SET ai_indexed_at = now() WHERE id = $1", [d.id]);
    });
  }
  return docs.length;
}

/** One indexing pass. Throws if the AI service fails (the job retries with backoff). */
export async function runAiIndex(): Promise<{ documents: number; listings: number; skipped?: string }> {
  if (!mlConfigured()) return { documents: 0, listings: 0, skipped: "ML_SERVICE_URL not set" };
  const documents = await indexDocuments();
  const listings = await indexProperties();
  if (documents || listings) log.info({ documents, listings }, "vector index updated");
  return { documents, listings };
}
