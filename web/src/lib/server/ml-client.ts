import "server-only";
import { breaker } from "./circuit-breaker";

/**
 * Client for the internal AI service (ml/, FastAPI + LlamaIndex): chunking, embeddings and
 * checked, cited answers. Browsers never call it; only this server and the worker do.
 *
 * - ML_SERVICE_URL unset → AI search is off and callers use keyword search instead.
 * - Each endpoint has its own circuit breaker (`ml:/v1/embed`, …), so an outage fails fast.
 * - ML_SERVICE_TOKEN is sent as a bearer token (required by the service in production).
 */

export const EMBED_DIM = 1024; // mxbai-embed-large (see database/migrations/010_embedding_model.sql)

export interface ChunkOut {
  page: number;
  ord: number;
  text: string;
}

export interface AnswerOut {
  answer: string;
  citations: string[];
  grounded: boolean;
  engine: string;
  reason: string | null;
}

function config() {
  const url = process.env.ML_SERVICE_URL?.trim().replace(/\/$/, "");
  return url ? { url, token: process.env.ML_SERVICE_TOKEN?.trim() || null } : null;
}

export const mlConfigured = () => config() !== null;

async function post<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const c = config();
  if (!c) throw new Error("ML_SERVICE_URL is not set");
  return breaker(`ml:${path}`, { failureThreshold: 4, resetAfterMs: 30_000, timeoutMs }).exec(async (signal) => {
    const res = await fetch(`${c.url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(c.token ? { Authorization: `Bearer ${c.token}` } : {}) },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`AI service ${path} returned ${res.status}`);
    return (await res.json()) as T;
  });
}

export async function embed(texts: string[], kind: "query" | "document"): Promise<number[][]> {
  const out: number[][] = [];
  // The service accepts up to 256 texts per call; smaller batches keep each call well under the timeout.
  for (let i = 0; i < texts.length; i += 64) {
    const { vectors } = await post<{ vectors: number[][] }>("/v1/embed", { texts: texts.slice(i, i + 64), kind }, 60_000);
    out.push(...vectors);
  }
  return out;
}

/** Embedding for a search query, or null when AI search is off or unavailable. */
export async function embedQuery(text: string): Promise<number[] | null> {
  if (!mlConfigured()) return null;
  try {
    return (await embed([text], "query"))[0] ?? null;
  } catch {
    return null;
  }
}

export async function chunkPages(pages: { page: number; text: string }[], chunkSize = 220, overlap = 40): Promise<ChunkOut[]> {
  const { chunks } = await post<{ chunks: ChunkOut[] }>("/v1/chunk", { pages, chunk_size: chunkSize, overlap }, 30_000);
  return chunks;
}

export async function answerFromPassages(question: string, passages: { id: string; label: string; page: number | null; text: string }[]): Promise<AnswerOut | null> {
  if (!mlConfigured()) return null;
  try {
    return await post<AnswerOut>("/v1/answer", { question, passages }, 90_000);
  } catch {
    return null;
  }
}

/** pgvector literal: '[0.1,0.2,…]' (cast with ::vector in SQL). */
export function toVector(v: number[]): string {
  if (v.length !== EMBED_DIM || v.some((x) => !Number.isFinite(x))) throw new Error(`Expected ${EMBED_DIM} finite numbers`);
  return `[${v.join(",")}]`;
}
