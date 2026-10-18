import "server-only";
import type { Viewer } from "@/lib/types";
import { contextFor } from "./auth";
import { withDb } from "./db";
import { notFound } from "./errors";
import { answerFromPassages, embedQuery, toVector } from "./ml-client";
import { fuse } from "./rank";

/**
 * "Ask the documents" (RAG) for one deal.
 *
 * Retrieval runs as the signed-in agent (withDb → row-level security), so passages from deals they
 * can't see are never retrieved, let alone sent to the model. Hybrid retrieval:
 *   - meaning: pgvector cosine distance on chunk embeddings (when the AI service is up)
 *   - keywords: PostgreSQL full-text search (always available)
 * fused with reciprocal-rank fusion. The answer is written and checked by the AI service; if it's
 * unavailable, the best passages are shown verbatim instead.
 */

export interface DocCitation {
  n: number;
  chunkId: string;
  documentId: string;
  label: string;
  page: number;
  excerpt: string;
}

export interface DocAnswer {
  answer: string;
  grounded: boolean;
  engine: string;
  retrieval: "hybrid" | "keyword";
  citations: DocCitation[];
  indexedDocuments: number;
  pendingDocuments: number;
}

interface Hit {
  id: string;
  document_id: string;
  label: string;
  page: number;
  content: string;
  rank: number;
}

const TOP = 6;
// Below this cosine similarity a passage is treated as unrelated (mxbai-embed-large scale).
const MIN_SIMILARITY = 0.35;

export async function askDocuments(viewer: Viewer, transactionId: string, question: string): Promise<DocAnswer> {
  const q = question.trim().slice(0, 500);
  const queryVector = await embedQuery(q);
  const { hits, indexed, pending } = await withDb(contextFor(viewer), async (db) => {
    if (!(await db.one("SELECT 1 FROM transactions WHERE id = $1", [transactionId]))) throw notFound("Deal");
    const counts = await db.one<{ indexed: number; pending: number }>(
      `SELECT count(*) FILTER (WHERE ai_indexed_at IS NOT NULL)::int AS indexed,
              count(*) FILTER (WHERE ai_indexed_at IS NULL AND ai_index_error IS NULL)::int AS pending
         FROM transaction_documents WHERE transaction_id = $1`,
      [transactionId],
    );
    const keyword = await db.query<Hit>(
      `SELECT c.id, c.document_id, d.label, c.page, c.content,
              ts_rank(c.tsv, replace(plainto_tsquery('english', $2)::text, '&', '|')::tsquery) AS rank
         FROM document_chunks c JOIN transaction_documents d ON d.id = c.document_id
        WHERE c.transaction_id = $1 AND c.tsv @@ replace(plainto_tsquery('english', $2)::text, '&', '|')::tsquery
        ORDER BY rank DESC LIMIT 20`,
      [transactionId, q],
    ).catch(() => [] as Hit[]); // a question made only of stop-words yields an empty tsquery
    const semantic = queryVector
      ? await db.query<Hit>(
          `SELECT c.id, c.document_id, d.label, c.page, c.content, 1 - (c.embedding <=> $2::vector) AS rank
             FROM document_chunks c JOIN transaction_documents d ON d.id = c.document_id
            WHERE c.transaction_id = $1 AND c.embedding IS NOT NULL
            ORDER BY c.embedding <=> $2::vector LIMIT 20`,
          [transactionId, toVector(queryVector)],
        )
      : [];
    return { hits: fuse([semantic.filter((h) => h.rank >= MIN_SIMILARITY), keyword], TOP), indexed: counts?.indexed ?? 0, pending: counts?.pending ?? 0 };
  });

  const citations: DocCitation[] = hits.map((h, i) => ({ n: i + 1, chunkId: h.id, documentId: h.document_id, label: h.label, page: h.page, excerpt: h.content }));
  const base = { retrieval: queryVector ? ("hybrid" as const) : ("keyword" as const), indexedDocuments: indexed, pendingDocuments: pending };
  if (!hits.length) {
    return { ...base, answer: indexed ? "The documents for this deal don't say." : "No documents on this deal have been indexed yet.", grounded: true, engine: "none", citations: [] };
  }

  const result = await answerFromPassages(q, citations.map((c) => ({ id: c.chunkId, label: c.label, page: c.page, text: c.excerpt })));
  if (!result) {
    const top = citations.slice(0, 2);
    return { ...base, answer: `AI answers are offline. Most relevant passages: ${top.map((c) => `“${c.excerpt.slice(0, 300)}” [${c.n}]`).join(" ")}`, grounded: true, engine: "extractive", citations: top };
  }
  // Keep only the passages the answer cites; their numbers already match the [n] markers in the text.
  const cited = new Set(result.citations);
  const used = citations.filter((c) => cited.has(c.chunkId));
  return { ...base, answer: result.answer, grounded: result.grounded, engine: result.engine, citations: used.length ? used : citations.slice(0, 2) };
}
