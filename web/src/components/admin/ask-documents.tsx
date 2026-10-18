"use client";

import { useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/client-api";

interface Citation { n: number; chunkId: string; documentId: string; label: string; page: number; excerpt: string }
interface Result { answer: string; grounded: boolean; engine: string; retrieval: "hybrid" | "keyword"; citations: Citation[]; indexedDocuments: number; pendingDocuments: number }

const EXAMPLES = ["When is closing?", "How much is the earnest money?", "How long is the inspection period?"];

/** "Ask the documents": questions answered only from this deal's files, with page citations. */
export function AskDocuments({ dealId, hasDocuments }: { dealId: string; hasDocuments: boolean }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  async function ask(e?: FormEvent, preset?: string) {
    e?.preventDefault();
    const q = (preset ?? question).trim();
    if (q.length < 3) return;
    setQuestion(q);
    setBusy(true);
    setError("");
    try {
      setResult(await api<Result>(`/api/deals/${dealId}/ask`, { method: "POST", body: { question: q } }));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't answer right now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!hasDocuments) return null;
  return (
    <div className="mt-6 rounded-2xl bg-fill p-4" aria-labelledby="ask-docs-h">
      <h3 id="ask-docs-h" className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-gold" aria-hidden /> Ask the documents</h3>
      <p className="mt-1 text-[0.75rem] text-ink-3">Answers come only from this deal&rsquo;s files and cite the page. Always confirm against the document before acting.</p>
      <form onSubmit={ask} className="mt-3 flex gap-2">
        <label htmlFor="ask-docs-q" className="sr-only">Question about this deal&rsquo;s documents</label>
        <Input id="ask-docs-q" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. When is the closing date?" maxLength={500} className="h-10" />
        <Button type="submit" size="sm" disabled={busy || question.trim().length < 3}>{busy ? "Reading…" : "Ask"}</Button>
      </form>
      {!result && !busy && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EXAMPLES.map((x) => (
            <button key={x} type="button" onClick={() => void ask(undefined, x)} className="pressable rounded-full bg-paper px-3 py-1 text-[0.75rem] ring-1 ring-line">{x}</button>
          ))}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
      {result && (
        <div className="mt-4 space-y-3" aria-live="polite">
          <p className="text-sm leading-relaxed">{result.answer}</p>
          <p className="text-[0.6875rem] uppercase tracking-[0.12em] text-ink-3">
            {result.engine.startsWith("ollama") ? "Local AI · checked against the cited pages" : result.engine === "extractive" ? "Passages only (AI answer unavailable or failed checks)" : "Search"}
            {" · "}{result.retrieval === "hybrid" ? "meaning + keyword search" : "keyword search"}
            {result.pendingDocuments > 0 && ` · ${result.pendingDocuments} document${result.pendingDocuments === 1 ? "" : "s"} still being indexed`}
          </p>
          {result.citations.length > 0 && (
            <ol className="space-y-2">
              {result.citations.map((c) => (
                <li key={c.chunkId} className="rounded-xl bg-paper p-3 text-[0.8125rem] ring-1 ring-line">
                  <a href={`/api/deals/${dealId}/documents/${c.documentId}`} className="font-medium underline underline-offset-4">[{c.n}] {c.label}, page {c.page}</a>
                  <p className="mt-1 text-ink-2">&ldquo;{c.excerpt.length > 360 ? `${c.excerpt.slice(0, 360)}…` : c.excerpt}&rdquo;</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
