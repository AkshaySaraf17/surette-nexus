import "server-only";
import { breaker } from "./circuit-breaker";

/**
 * Local AI via Ollama (open-weight models running on your own machine or server).
 *
 * - Never calls a hosted/paid AI API. If OLLAMA_URL is unset or Ollama is down, callers
 *   get null and use their deterministic fallback, so every workflow still works.
 * - Model output is untrusted text: callers validate it (e.g. every dollar figure must
 *   come from the calculation) before showing it, and label it as AI-written.
 *
 * Configure: OLLAMA_URL=http://localhost:11434  OLLAMA_MODEL=llama3.2:3b
 */

const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 25_000);

function config() {
  const url = process.env.OLLAMA_URL?.trim().replace(/\/$/, "");
  const model = process.env.OLLAMA_MODEL?.trim() || "llama3.2:3b";
  return url ? { url, model } : null;
}

const ollama = () => breaker("ollama", { failureThreshold: 3, resetAfterMs: 30_000, timeoutMs: TIMEOUT_MS });

let lastHealth: { ok: boolean; at: number; models: string[] } | null = null;

export async function aiStatus(): Promise<{ configured: boolean; available: boolean; model: string | null; models: string[] }> {
  const c = config();
  if (!c) return { configured: false, available: false, model: null, models: [] };
  if (!lastHealth || Date.now() - lastHealth.at > 30_000) {
    try {
      if (ollama().state === "open") throw new Error("circuit open");
      const res = await fetch(`${c.url}/api/tags`, { signal: AbortSignal.timeout(2_000) });
      const data = (await res.json()) as { models?: { name: string }[] };
      lastHealth = { ok: res.ok, at: Date.now(), models: (data.models ?? []).map((m) => m.name) };
    } catch {
      lastHealth = { ok: false, at: Date.now(), models: [] };
    }
  }
  return { configured: true, available: lastHealth.ok && lastHealth.models.some((m) => m.startsWith(c.model.split(":")[0])), model: c.model, models: lastHealth.models };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** One-shot completion. Returns null when local AI isn't available. */
export async function complete(messages: ChatMessage[], options: { temperature?: number; maxTokens?: number } = {}): Promise<{ text: string; engine: string } | null> {
  const c = config();
  if (!c) return null;
  try {
    // The breaker fails fast while Ollama is down, so callers reach their built-in answer immediately.
    const data = await ollama().exec(async (signal) => {
      const res = await fetch(`${c.url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: c.model, messages, stream: false, options: { temperature: options.temperature ?? 0.3, num_predict: options.maxTokens ?? 500 } }),
        signal,
      });
      if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
      return (await res.json()) as { message?: { content?: string } };
    });
    const text = data.message?.content?.trim();
    return text ? { text, engine: `ollama:${c.model}` } : null;
  } catch {
    return null;
  }
}

/** Streaming completion; yields text deltas. Throws if unavailable (callers fall back). */
export async function* stream(messages: ChatMessage[], options: { temperature?: number; maxTokens?: number } = {}): AsyncGenerator<string> {
  const c = config();
  if (!c) throw new Error("Local AI not configured");
  // The breaker guards connecting and the first response; the body then streams normally.
  const res = await ollama().exec(async () => {
    const r = await fetch(`${c.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: c.model, messages, stream: true, options: { temperature: options.temperature ?? 0.4, num_predict: options.maxTokens ?? 600 } }),
      signal: AbortSignal.timeout(TIMEOUT_MS * 2),
    });
    if (!r.ok || !r.body) throw new Error(`Ollama returned ${r.status}`);
    return r;
  });
  if (!res.body) throw new Error("Ollama returned no body");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const chunk = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
      if (chunk.message?.content) yield chunk.message.content;
    }
  }
}

/**
 * Guard for AI text that discusses numbers: every dollar amount in the text must be one of
 * the allowed (computed) amounts. Returns false if the model invented a figure.
 */
export function onlyKnownAmounts(text: string, allowedCents: number[]): boolean {
  const allowed = new Set(allowedCents.map((c) => Math.round(c / 100)));
  const found = [...text.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)\s*(k|m|million)?/gi)];
  return found.every((m) => {
    let dollars = Number(m[1].replace(/,/g, ""));
    const unit = m[2]?.toLowerCase();
    if (unit === "k") dollars *= 1_000;
    if (unit === "m" || unit === "million") dollars *= 1_000_000;
    const rounded = Math.round(dollars);
    // Accept exact matches, or matches within rounding of a computed amount (e.g. "$1.25M").
    return [...allowed].some((a) => Math.abs(a - rounded) <= Math.max(1, a * 0.005));
  });
}
