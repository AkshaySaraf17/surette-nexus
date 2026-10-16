"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState, type FormEvent } from "react";
import { ArrowUp, Bot, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, ApiClientError } from "@/lib/client-api";
import { cn } from "@/lib/utils";

interface Answer {
  answer: string;
  items?: { label: string; detail?: string; href?: string; tone?: "danger" | "warn" | "ok" }[];
  links?: { label: string; href: string }[];
}
const PROMPTS = ["What's due this week?", "Summarize the pipeline", "New leads", "Upcoming showings", "Status of Lake House", "Draft update for Lake House"];

/** Floating ops assistant for the team. Answers come from live data scoped to the user's access. */
export function OpsAssistant() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [log, setLog] = useState<{ q: string; a: Answer | null; error?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  async function ask(question: string, e?: FormEvent) {
    e?.preventDefault();
    if (!question.trim() || busy) return;
    setQ("");
    setBusy(true);
    setLog((l) => [...l, { q: question, a: null }]);
    try {
      const a = await api<Answer>("/api/agent/ops", { method: "POST", body: { question } });
      setLog((l) => l.map((x, i) => (i === l.length - 1 ? { ...x, a } : x)));
    } catch (err) {
      setLog((l) => l.map((x, i) => (i === l.length - 1 ? { ...x, error: err instanceof ApiClientError ? err.message : "Couldn't answer." } : x)));
    } finally {
      setBusy(false);
      setTimeout(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }), 50);
    }
  }

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="pressable fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-ink px-4 py-3 text-sm font-medium text-paper shadow-lg" aria-label="Ask ops — open the operations assistant">
          <Bot className="size-4 text-gold-soft" aria-hidden /> Ask ops
        </button>
      )}
      <AnimatePresence>
        {open && (
          <motion.section role="dialog" aria-label="Ops assistant" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} transition={{ type: "spring", bounce: 0, duration: 0.4 }} className="fixed inset-x-3 bottom-3 z-50 flex max-h-[min(640px,calc(100dvh-1.5rem))] flex-col overflow-hidden rounded-[24px] bg-paper shadow-lg ring-1 ring-line sm:inset-x-auto sm:right-6 sm:w-[400px]">
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <div><p className="text-sm font-medium">Ops assistant</p><p className="text-[0.75rem] text-ink-3">Live data · only what you can access · never sends anything</p></div>
              <button type="button" onClick={() => setOpen(false)} className="pressable grid size-8 place-items-center rounded-full bg-fill" aria-label="Close"><X className="size-4" /></button>
            </header>
            <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
              {log.length === 0 && (
                <div className="flex flex-wrap gap-2">
                  {PROMPTS.map((p) => <button key={p} type="button" onClick={() => void ask(p)} className="pressable rounded-full border border-line-strong px-3 py-1.5 text-[0.8125rem] hover:bg-fill">{p}</button>)}
                </div>
              )}
              {log.map((x, i) => (
                <div key={i} className="space-y-2">
                  <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-ink px-3 py-2 text-sm text-paper">{x.q}</p>
                  {x.error ? <p className="text-sm text-danger">{x.error}</p> : !x.a ? <p className="text-sm text-ink-3">Looking…</p> : (
                    <div className="text-sm">
                      <p>{x.a.answer}</p>
                      {x.a.items && x.a.items.length > 0 && (
                        <ul className="mt-2 divide-y divide-line rounded-2xl ring-1 ring-line">
                          {x.a.items.map((it, k) => {
                            const body = <><span className={cn("block font-medium", it.tone === "danger" && "text-danger", it.tone === "warn" && "text-warn")}>{it.label}</span>{it.detail && <span className="block text-[0.75rem] text-ink-3">{it.detail}</span>}</>;
                            return <li key={k} className="px-3 py-2">{it.href ? <Link href={it.href} className="block hover:underline">{body}</Link> : body}</li>;
                          })}
                        </ul>
                      )}
                      {x.a.links?.map((l) => <Link key={l.href} href={l.href} className="mt-2 inline-block text-[0.8125rem] font-medium underline underline-offset-4">{l.label} →</Link>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <form onSubmit={(e) => void ask(q, e)} className="flex gap-2 border-t border-line p-3">
              <label htmlFor="ops-q" className="sr-only">Ask the ops assistant</label>
              <input id="ops-q" value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder="e.g. What's overdue?" className="h-10 flex-1 rounded-full border border-line-strong bg-paper px-4 text-sm focus:border-gold focus:outline-none" />
              <Button type="submit" size="icon" className="size-10" disabled={busy || !q.trim()} aria-label="Ask"><ArrowUp /></Button>
            </form>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
}
