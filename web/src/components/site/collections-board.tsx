"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Heart, HelpCircle, Plus, Send, ThumbsDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiClientError } from "@/lib/client-api";
import { formatPrice, formatRent } from "@/lib/money";
import type { Collection, Reaction, Viewer } from "@/lib/types";
import { useLiveEvents, useLiveStatus } from "@/lib/use-live";
import { cn } from "@/lib/utils";
import { ListingImage } from "./listing-image";

/**
 * Compass-style Collections. Clients react (love / maybe / pass), annotate and
 * discuss homes; their assigned agent sees the same board (in the portal) and
 * replies. Every change arrives over the live feed, so both sides stay in sync
 * without refreshing.
 */

const REACTIONS: { value: Reaction; label: string; icon: typeof Heart; on: string }[] = [
  { value: "love", label: "Love", icon: Heart, on: "bg-[#c2410c] text-white border-transparent" },
  { value: "maybe", label: "Maybe", icon: HelpCircle, on: "bg-gold text-white border-transparent" },
  { value: "pass", label: "Pass", icon: ThumbsDown, on: "bg-ink text-paper border-transparent" },
];

const time = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

function NoteEditor({ initial, onSave, label }: { initial: string; onSave: (note: string) => Promise<void>; label: string }) {
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  // eslint-disable-next-line react-hooks/set-state-in-effect -- adopt the saved note when it changes remotely
  useEffect(() => setValue(initial), [initial]);
  useEffect(() => {
    if (value === initial) return;
    const t = setTimeout(async () => {
      setState("saving");
      await onSave(value);
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    }, 700);
    return () => clearTimeout(t);
  }, [value, initial, onSave]);
  return (
    <div className="relative">
      <label className="sr-only" htmlFor={`note-${label}`}>Note on {label}</label>
      <Textarea id={`note-${label}`} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Add a private note for you and your agent…" className="min-h-16 text-sm" maxLength={2000} />
      <span className="absolute bottom-2 right-3 text-[0.6875rem] text-ink-3" aria-live="polite">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : ""}</span>
    </div>
  );
}

export function CollectionsBoard({ viewer }: { viewer: Viewer }) {
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const live = useLiveStatus();
  const isAgent = viewer.role !== "client";

  const load = useCallback(async () => {
    try {
      const { collections } = await api<{ collections: Collection[] }>("/api/collections");
      setCollections(collections);
      setActiveId((id) => (id && collections.some((c) => c.id === id) ? id : collections[0]?.id ?? null));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load collections.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);
  useLiveEvents(() => void load(), (e) => e.table.startsWith("collection"));

  const active = collections?.find((c) => c.id === activeId) ?? null;

  const replace = (next: Collection) => setCollections((all) => all?.map((c) => (c.id === next.id ? next : c)) ?? null);

  async function react(propertyId: string, reaction: Reaction | null) {
    if (!active) return;
    const { collection } = await api<{ collection: Collection }>(`/api/collections/${active.id}/items`, { method: "POST", body: { propertyId, reaction } });
    replace(collection);
  }
  const saveNote = useCallback(
    async (collectionId: string, propertyId: string, note: string) => {
      const { collection } = await api<{ collection: Collection }>(`/api/collections/${collectionId}/items`, { method: "POST", body: { propertyId, note: note || null } });
      replace(collection);
    },
    [],
  );
  async function remove(propertyId: string) {
    if (!active) return;
    const { collection } = await api<{ collection: Collection }>(`/api/collections/${active.id}/items?propertyId=${propertyId}`, { method: "DELETE" });
    replace(collection);
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const { collection } = await api<{ collection: Collection }>("/api/collections", { method: "POST", body: { name: newName } });
      setCollections((all) => [collection, ...(all ?? [])]);
      setActiveId(collection.id);
      setNewName("");
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't create the collection.");
    }
  }
  async function postComment(e: FormEvent) {
    e.preventDefault();
    if (!active || !comment.trim()) return;
    const body = comment;
    setComment("");
    try {
      const { collection } = await api<{ collection: Collection }>(`/api/collections/${active.id}/comments`, { method: "POST", body: { body } });
      replace(collection);
    } catch (e) {
      setComment(body);
      setError(e instanceof ApiClientError ? e.message : "Couldn't send.");
    }
  }

  if (collections === null) {
    return <Skeleton className="h-96 w-full rounded-[28px]" />;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="no-scrollbar flex gap-2 overflow-x-auto" role="tablist" aria-label="Collections">
          {collections.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={c.id === activeId}
              type="button"
              onClick={() => setActiveId(c.id)}
              className={cn("pressable shrink-0 rounded-full border px-4 py-2 text-sm", c.id === activeId ? "border-ink bg-ink text-paper" : "border-line-strong hover:bg-fill")}
            >
              {c.name} <span className="opacity-60">· {c.items.length}</span>
              {isAgent && <span className="ml-1 opacity-60">({c.ownerName})</span>}
            </button>
          ))}
        </div>
        {!isAgent && (
          <form onSubmit={create} className="flex gap-2">
            <label htmlFor="new-collection" className="sr-only">New collection name</label>
            <Input id="new-collection" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New collection" className="h-10 w-48" maxLength={80} />
            <Button type="submit" size="sm" variant="outline" className="h-10" aria-label="Create collection"><Plus /></Button>
          </form>
        )}
      </div>
      <p className="mt-4 flex items-center gap-2 text-[0.8125rem] text-ink-3">
        <span className={cn("size-2 rounded-full", live ? "bg-success" : "bg-ink-3")} aria-hidden />
        {isAgent ? "Live with your clients" : active?.agent ? `Shared live with ${active.agent.fullName}` : "Private to you"}
      </p>
      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}

      {!active ? (
        <div className="mt-12 rounded-[28px] border border-dashed border-line-strong p-12 text-center">
          <p className="type-headline">{isAgent ? "No client collections yet." : "Start a collection."}</p>
          {!isAgent && <p className="mt-2 text-ink-2">Tap the heart on any home to save it here. <Link href="/listings" className="underline underline-offset-4">Browse homes →</Link></p>}
        </div>
      ) : (
        <div className="mt-10 grid gap-10 lg:grid-cols-12">
          <ul className="space-y-6 lg:col-span-8">
            <AnimatePresence initial={false}>
              {active.items.length === 0 && (
                <li className="rounded-[28px] border border-dashed border-line-strong p-10 text-center text-ink-2">
                  This collection is empty. <Link href="/listings" className="underline underline-offset-4">Find homes →</Link>
                </li>
              )}
              {active.items.map((item) => (
                <motion.li
                  key={item.listing.id}
                  layout
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -30 }}
                  transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                  className="grid gap-5 overflow-hidden rounded-[28px] bg-paper p-4 ring-1 ring-line sm:grid-cols-[220px_1fr]"
                >
                  <Link href={`/listings/${item.listing.slug}`} className="overflow-hidden rounded-2xl">
                    <ListingImage image={item.listing.cover} alt={item.listing.title} sizes="220px" className="aspect-[4/3] w-full transition-transform duration-700 hover:scale-105" />
                  </Link>
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link href={`/listings/${item.listing.slug}`} className="type-headline hover:underline">{item.listing.title}</Link>
                        <p className="text-sm text-ink-2">
                          {item.listing.city} · {item.listing.listingType === "rent" ? formatRent(item.listing.priceCents) : formatPrice(item.listing.priceCents)} · {item.listing.bedrooms} bd
                        </p>
                      </div>
                      {!isAgent && (
                        <button type="button" onClick={() => void remove(item.listing.id)} className="pressable grid size-9 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-fill hover:text-danger" aria-label={`Remove ${item.listing.title}`}>
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </div>
                    <div className="mt-3 flex gap-2" role="group" aria-label="Your reaction">
                      {REACTIONS.map((r) => {
                        const on = item.reaction === r.value;
                        return (
                          <button
                            key={r.value}
                            type="button"
                            aria-pressed={on}
                            disabled={isAgent}
                            onClick={() => void react(item.listing.id, on ? null : r.value)}
                            className={cn("pressable flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-[0.8125rem] disabled:cursor-default disabled:opacity-100", on && r.on)}
                          >
                            <r.icon className="size-3.5" aria-hidden /> {r.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-3">
                      {isAgent ? (
                        item.note && <p className="rounded-2xl bg-fill p-3 text-sm text-ink-2">“{item.note}”</p>
                      ) : (
                        <NoteEditor initial={item.note ?? ""} label={item.listing.title} onSave={(note) => saveNote(active.id, item.listing.id, note)} />
                      )}
                    </div>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>

          <section className="lg:col-span-4" aria-labelledby="thread-heading">
            <div className="sticky top-24 flex max-h-[70vh] flex-col rounded-[28px] bg-paper ring-1 ring-line">
              <h2 id="thread-heading" className="border-b border-line px-5 py-4 font-medium">
                Conversation {active.agent && !isAgent ? `with ${active.agent.fullName}` : isAgent ? `with ${active.ownerName}` : ""}
              </h2>
              <ol className="flex-1 space-y-4 overflow-y-auto px-5 py-4" aria-live="polite">
                {active.comments.length === 0 && <li className="text-sm text-ink-3">No messages yet.</li>}
                {active.comments.map((c) => {
                  const mine = c.authorId === viewer.id;
                  return (
                    <li key={c.id} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
                      <p className={cn("max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm", mine ? "rounded-br-md bg-ink text-paper" : "rounded-bl-md bg-fill")}>{c.body}</p>
                      <p className="mt-1 text-[0.6875rem] text-ink-3">
                        {c.authorName}{c.authorRole !== "client" ? " · Agent" : ""} · {time(c.createdAt)}
                      </p>
                    </li>
                  );
                })}
              </ol>
              <form onSubmit={postComment} className="flex gap-2 border-t border-line p-3">
                <label htmlFor="thread-input" className="sr-only">Message</label>
                <Input id="thread-input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={isAgent ? "Reply to your client…" : "Message your agent…"} maxLength={2000} className="h-10" />
                <Button type="submit" size="icon" className="size-10 shrink-0" disabled={!comment.trim()} aria-label="Send"><Send /></Button>
              </form>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
