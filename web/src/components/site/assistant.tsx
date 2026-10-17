"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, BookmarkPlus, CalendarCheck, Check, Sparkles, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/client-api";
import { track } from "@/lib/analytics-client";
import { formatPrice, formatRent } from "@/lib/money";
import { CONTACT_CONSENT_TEXT } from "@/lib/privacy";
import type { AssistantEvent, ListingCard } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ListingImage } from "./listing-image";
import { useSaved } from "./saved-context";

/**
 * The AI assistant: answers from live inventory (with match explanations, source and
 * freshness), shares public market data, books showings, saves searches and hands off to
 * an agent — each hand-off only after the visitor fills a form and consents.
 */

type Matches = Record<string, { met: string[]; unmet: string[] }>;
interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  listings?: ListingCard[];
  matches?: Matches;
  relaxed?: string | null;
  market?: Extract<AssistantEvent, { type: "market" }>["facts"];
  links?: { label: string; href: string }[];
  followups?: string[];
  saveSearch?: { criteria: Record<string, unknown>; signedIn: boolean };
  handoff?: { preferences: string[]; propertyId: string | null };
  proposal?: { listing: ListingCard; slots: { startsAt: string; endsAt: string }[] };
  engine?: string;
  error?: boolean;
}

const SUGGESTIONS = ["3 bedrooms under $600K with a garage", "Lake houses in Oakland", "What are mortgage rates right now?", "I need to sell my home and buy another"];

const slotLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

const freshness = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "status confirmed today" : `status confirmed ${days} day${days === 1 ? "" : "s"} ago`;
};

function ConsentBox({ checked, onChange, error }: { checked: boolean; onChange: (v: boolean) => void; error?: string }) {
  return (
    <div>
      <label className="flex items-start gap-2.5 text-[0.8125rem] text-ink-2">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-[var(--gold)]" />
        <span>{CONTACT_CONSENT_TEXT}</span>
      </label>
      {error && <p className="mt-1 text-[0.8125rem] text-danger">{error}</p>}
    </div>
  );
}

function ShowingBooking({ listing, slots }: { listing: ListingCard; slots: { startsAt: string; endsAt: string }[] }) {
  const { viewer } = useSaved();
  const [slot, setSlot] = useState(slots[0]?.startsAt ?? "");
  const [name, setName] = useState(viewer?.fullName ?? "");
  const [email, setEmail] = useState(viewer?.email ?? "");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => track("showing_request_start", { property_id: listing.id }), [listing.id]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrors({});
    try {
      await api("/api/showings", { method: "POST", body: { propertyId: listing.id, contactName: name, contactEmail: email, contactPhone: phone || null, startsAt: slot, source: "ai_assistant", consentContact: consent || undefined } });
      setStatus("done");
      track("showing_request_submit", { property_id: listing.id, source: "ai_assistant" });
      setMessage(`Requested for ${slotLabel(slot)}. The listing agent will confirm by email.`);
    } catch (error) {
      setStatus("idle");
      if (error instanceof ApiClientError) {
        setErrors(error.fields);
        setMessage(error.message);
      } else setMessage("Something went wrong. Please try again.");
    }
  }

  if (status === "done") {
    return (
      <div className="mt-3 flex items-start gap-3 rounded-2xl bg-success-bg p-4 text-sm text-success" role="status">
        <CalendarCheck className="mt-0.5 size-4 shrink-0" /> {message}
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-2xl border border-line bg-paper p-4" aria-label={`Request a private showing of ${listing.title}`}>
      <p className="text-sm font-medium">Private showing · {listing.title}</p>
      <fieldset>
        <legend className="sr-only">Choose a time</legend>
        <div className="flex flex-wrap gap-2">
          {slots.map((s) => (
            <label key={s.startsAt} className={cn("pressable cursor-pointer rounded-full border px-3 py-1.5 text-[0.8125rem]", slot === s.startsAt ? "border-ink bg-ink text-paper" : "border-line-strong")}>
              <input type="radio" name="slot" value={s.startsAt} checked={slot === s.startsAt} onChange={() => setSlot(s.startsAt)} className="sr-only" />
              {slotLabel(s.startsAt)}
            </label>
          ))}
        </div>
        {errors.startsAt && <p className="mt-1 text-[0.8125rem] text-danger">{errors.startsAt}</p>}
      </fieldset>
      <Field label="Name" htmlFor="sh-name" error={errors.contactName}>
        <Input id="sh-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
      </Field>
      <Field label="Email" htmlFor="sh-email" error={errors.contactEmail}>
        <Input id="sh-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      </Field>
      <Field label="Mobile (optional)" htmlFor="sh-phone" error={errors.contactPhone}>
        <Input id="sh-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
      </Field>
      <ConsentBox checked={consent} onChange={setConsent} error={errors.consentContact} />
      {message && <p className="text-[0.8125rem] text-danger" role="alert">{message}</p>}
      <Button type="submit" size="sm" className="w-full" disabled={status === "sending" || !slot}>
        {status === "sending" ? "Requesting…" : "Request this time"}
      </Button>
    </form>
  );
}

function Handoff({ preferences, propertyId }: { preferences: string[]; propertyId: string | null }) {
  const { viewer } = useSaved();
  const [name, setName] = useState(viewer?.fullName ?? "");
  const [email, setEmail] = useState(viewer?.email ?? "");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [message, setMessage] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    setErrors({});
    try {
      await api("/api/leads", {
        method: "POST",
        body: {
          source: "ai_assistant",
          contactName: name,
          contactEmail: email || null,
          contactPhone: phone || null,
          message: note || "Requested help from the website AI assistant.",
          propertyId,
          preferences: preferences.length ? { stated: preferences } : undefined,
          consentContact: consent || undefined,
        },
      });
      track("contact_submit", { source: "ai_assistant" });
      setState("done");
    } catch (error) {
      setState("idle");
      if (error instanceof ApiClientError) {
        setErrors(error.fields);
        setMessage(error.message);
      } else setMessage("Something went wrong.");
    }
  }

  if (state === "done") {
    return (
      <div className="mt-3 flex items-start gap-3 rounded-2xl bg-success-bg p-4 text-sm text-success" role="status">
        <Check className="mt-0.5 size-4 shrink-0" /> Thanks — an agent will reach out shortly.
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-2xl border border-line bg-paper p-4" data-sa-form="assistant-handoff" aria-label="Contact an agent">
      <p className="flex items-center gap-2 text-sm font-medium"><UserRound className="size-4" aria-hidden /> Talk with an agent</p>
      {preferences.length > 0 && (
        <p className="text-[0.8125rem] text-ink-2">We&rsquo;ll include what you asked for: {preferences.join(", ")}. Nothing else from this chat is shared.</p>
      )}
      <Field label="Name" htmlFor="ho-name" error={errors.contactName}>
        <Input id="ho-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Email" htmlFor="ho-email" error={errors.contactEmail}>
          <Input id="ho-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </Field>
        <Field label="Phone" htmlFor="ho-phone" error={errors.contactPhone}>
          <Input id="ho-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
        </Field>
      </div>
      <Field label="Anything to add? (optional)" htmlFor="ho-note">
        <Textarea id="ho-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} className="min-h-16" />
      </Field>
      <ConsentBox checked={consent} onChange={setConsent} error={errors.consentContact} />
      {message && <p className="text-[0.8125rem] text-danger" role="alert">{message}</p>}
      <Button type="submit" size="sm" className="w-full" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send to the team"}</Button>
    </form>
  );
}

function SaveSearch({ criteria, signedIn }: { criteria: Record<string, unknown>; signedIn: boolean }) {
  const [state, setState] = useState<"idle" | "saved" | "error">("idle");
  if (!signedIn) {
    return (
      <p className="mt-3 text-[0.8125rem] text-ink-3">
        <Link href="/sign-in?mode=signup" className="underline underline-offset-2">Create a free account</Link> to save this search and your favorite homes.
      </p>
    );
  }
  return (
    <button
      type="button"
      disabled={state === "saved"}
      onClick={async () => {
        try {
          await api("/api/account/searches", { method: "POST", body: { name: `Search ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, criteria } });
          setState("saved");
        } catch {
          setState("error");
        }
      }}
      className="pressable mt-3 inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-[0.8125rem] disabled:opacity-60"
    >
      <BookmarkPlus className="size-3.5" aria-hidden /> {state === "saved" ? "Saved to your account" : state === "error" ? "Couldn't save — try again" : "Save this search"}
    </button>
  );
}

export function Assistant() {
  const pathname = usePathname();
  const listingSlug = pathname.startsWith("/listings/") ? pathname.split("/")[2] : undefined;
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const onOpen = (e: Event) => {
      setOpen(true);
      track("assistant_open", { surface: "button" });
      const prompt = (e as CustomEvent<string | undefined>).detail;
      if (prompt) void send(prompt);
    };
    window.addEventListener("assistant:open", onOpen);
    return () => window.removeEventListener("assistant:open", onOpen);
  });

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const userTurn: Turn = { id: crypto.randomUUID(), role: "user", text: content };
    const reply: Turn = { id: crypto.randomUUID(), role: "assistant", text: "" };
    const history = [...turns, userTurn];
    setTurns([...history, reply]);
    setInput("");
    setBusy(true);
    abort.current = new AbortController();
    const patch = (fn: (t: Turn) => Turn) => setTurns((all) => all.map((t) => (t.id === reply.id ? fn(t) : t)));
    let resultCount = 0;
    try {
      const response = await fetch("/api/agent/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.filter((t) => t.text && !t.error).slice(-12).map((t) => ({ role: t.role, content: t.text.slice(0, 2000) })), listingSlug }),
        signal: abort.current.signal,
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "The AI assistant is unavailable right now.");
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
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
          const ev = JSON.parse(line) as AssistantEvent;
          if (ev.type === "text") patch((t) => ({ ...t, text: t.text + ev.delta }));
          else if (ev.type === "listings") {
            resultCount = ev.listings.length;
            patch((t) => ({ ...t, listings: ev.listings, matches: ev.matches, relaxed: ev.relaxed }));
          } else if (ev.type === "market") patch((t) => ({ ...t, market: ev.facts }));
          else if (ev.type === "links") patch((t) => ({ ...t, links: ev.links }));
          else if (ev.type === "followup") patch((t) => ({ ...t, followups: ev.questions }));
          else if (ev.type === "save_search") patch((t) => ({ ...t, saveSearch: { criteria: ev.criteria, signedIn: ev.signedIn } }));
          else if (ev.type === "handoff") patch((t) => ({ ...t, handoff: { preferences: ev.preferences, propertyId: ev.propertyId } }));
          else if (ev.type === "showing_proposal") patch((t) => ({ ...t, proposal: { listing: ev.listing, slots: ev.slots } }));
          else if (ev.type === "done") patch((t) => ({ ...t, engine: ev.engine }));
          else if (ev.type === "error") patch((t) => ({ ...t, text: ev.message, error: true }));
        }
      }
      track("assistant_message", { results: resultCount });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) patch((t) => ({ ...t, text: error instanceof Error ? error.message : "Something went wrong.", error: true }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            transition={{ type: "spring", bounce: 0.25, duration: 0.5 }}
            onClick={() => {
              setOpen(true);
              track("assistant_open", { surface: "floating" });
            }}
            className="pressable fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-ink px-5 py-3.5 text-sm font-medium text-paper shadow-lg sm:bottom-8 sm:right-8"
            aria-label="Open the AI assistant"
          >
            <Sparkles className="size-4 text-gold-soft" aria-hidden /> AI assistant
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.section
            role="dialog"
            aria-label="Surette AI assistant"
            data-lenis-prevent
            initial={{ opacity: 0, y: 30, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.97 }}
            transition={{ type: "spring", bounce: 0, duration: 0.45 }}
            style={{ transformOrigin: "bottom right" }}
            className="fixed inset-x-3 bottom-3 z-50 flex max-h-[min(760px,calc(100dvh-1.5rem))] flex-col overflow-hidden rounded-[28px] bg-paper text-ink shadow-lg ring-1 ring-line sm:inset-x-auto sm:bottom-8 sm:right-8 sm:w-[440px]"
          >
            <header className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <p className="type-eyebrow text-gold">Surette AI assistant</p>
                <p className="text-sm text-ink-2">Live listings · market data · showings</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="pressable grid size-9 place-items-center rounded-full bg-fill" aria-label="Close the AI assistant">
                <X className="size-4" />
              </button>
            </header>

            <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto px-5 py-5" aria-live="polite">
              {turns.length === 0 && (
                <div>
                  <p className="type-headline">Good day. How may I help?</p>
                  <p className="mt-2 text-sm text-ink-2">Describe the home you want in your own words — I&rsquo;ll search current listings and explain what matches.</p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} type="button" onClick={() => void send(s)} className="pressable rounded-full border border-line-strong px-3 py-1.5 text-[0.8125rem] hover:bg-fill">
                        {s}
                      </button>
                    ))}
                  </div>
                  <p className="mt-6 text-[0.75rem] leading-relaxed text-ink-3">
                    The AI assistant searches Surette&rsquo;s listing database. Nothing you type is sent to the team unless you choose to contact an agent or request a showing.
                  </p>
                </div>
              )}
              {turns.map((t) => (
                <div key={t.id} className={cn("flex", t.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[92%]", t.role === "user" && "rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-sm text-paper")}>
                    {t.role === "assistant" ? (
                      <>
                        {t.listings && t.listings.length > 0 && (
                          <ul className="mb-3 space-y-2">
                            {t.listings.map((l) => {
                              const m = t.matches?.[l.id];
                              return (
                                <li key={l.id}>
                                  <Link href={`/listings/${l.slug}`} data-sa-property-card={l.id} className="block rounded-2xl p-1.5 ring-1 ring-line transition-colors hover:bg-fill">
                                    <span className="flex gap-3">
                                      <ListingImage image={l.cover} alt={l.title} sizes="96px" className="h-16 w-24 shrink-0 rounded-xl" />
                                      <span className="min-w-0 self-center">
                                        <span className="block truncate text-sm font-medium">{l.title}</span>
                                        <span className="block text-[0.8125rem] text-ink-2">
                                          {l.city} · {l.listingType === "rent" ? formatRent(l.priceCents) : formatPrice(l.priceCents)} · {l.bedrooms} bd
                                        </span>
                                      </span>
                                    </span>
                                    {m && (m.met.length > 0 || m.unmet.length > 0) && (
                                      <span className="mt-1.5 flex flex-wrap gap-1 px-1 text-[0.6875rem]">
                                        {m.met.map((x) => <span key={x} className="rounded-full bg-success-bg px-2 py-0.5 text-success">✓ {x}</span>)}
                                        {m.unmet.map((x) => <span key={x} className="rounded-full bg-warn-bg px-2 py-0.5 text-warn">△ {x}</span>)}
                                      </span>
                                    )}
                                    <span className="block px-1 pt-1 text-[0.6875rem] text-ink-3">
                                      {l.source === "demo" ? "Demo listing" : "Surette listing"} · {freshness(l.statusVerifiedAt)}
                                    </span>
                                  </Link>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                        <p className={cn("whitespace-pre-line text-[0.9375rem] leading-relaxed", t.error && "text-danger")}>
                          {t.text || (
                            <span className="inline-flex gap-1" aria-label="Thinking">
                              <span className="size-1.5 animate-pulse rounded-full bg-ink-3" />
                              <span className="size-1.5 animate-pulse rounded-full bg-ink-3 [animation-delay:150ms]" />
                              <span className="size-1.5 animate-pulse rounded-full bg-ink-3 [animation-delay:300ms]" />
                            </span>
                          )}
                        </p>
                        {t.market && t.market.length > 0 && (
                          <ul className="mt-3 space-y-1.5 rounded-2xl bg-fill p-3 text-[0.8125rem]">
                            {t.market.map((f) => (
                              <li key={f.label}>
                                <span className="font-medium">{f.value}</span> — {f.label}
                                <span className="block text-[0.6875rem] text-ink-3">{f.source} · period {f.period} · retrieved {new Date(f.retrievedAt).toLocaleDateString("en-US")}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {t.links && t.links.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {t.links.map((l) => (
                              <Link key={l.href} href={l.href} className="pressable rounded-full bg-fill px-3 py-1.5 text-[0.8125rem] hover:bg-line">{l.label} →</Link>
                            ))}
                          </div>
                        )}
                        {t.followups && t.followups.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {t.followups.map((q) => (
                              <button key={q} type="button" onClick={() => setInput(q.replace(/\?$/, "").replace(/^(What|Any|How many) /, "") + " ")} className="pressable rounded-full border border-dashed border-line-strong px-3 py-1.5 text-left text-[0.8125rem] text-ink-2">
                                {q}
                              </button>
                            ))}
                          </div>
                        )}
                        {t.saveSearch && <SaveSearch criteria={t.saveSearch.criteria} signedIn={t.saveSearch.signedIn} />}
                        {t.proposal && <ShowingBooking listing={t.proposal.listing} slots={t.proposal.slots} />}
                        {t.handoff && <Handoff preferences={t.handoff.preferences} propertyId={t.handoff.propertyId} />}
                        {t.engine && <p className="mt-2 text-[0.6875rem] text-ink-3">{t.engine === "ollama" ? "Phrased by a local AI model from Surette's data" : "Answered from Surette's data"}</p>}
                      </>
                    ) : (
                      t.text
                    )}
                  </div>
                </div>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
              className="flex items-end gap-2 border-t border-line p-3"
            >
              <label htmlFor="assistant-input" className="sr-only">Message the AI assistant</label>
              <textarea
                id="assistant-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                rows={1}
                maxLength={2000}
                placeholder={listingSlug ? "Ask about this home…" : "e.g. 3 bedrooms in Waterville under $450K"}
                className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-line-strong bg-paper px-4 py-2.5 text-[0.9375rem] focus:border-gold focus:outline-none"
              />
              <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Send">
                <ArrowUp />
              </Button>
            </form>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
}

/** Open the AI assistant from anywhere (optionally with a first message). */
export function openAssistant(prompt?: string) {
  window.dispatchEvent(new CustomEvent("assistant:open", { detail: prompt }));
}
