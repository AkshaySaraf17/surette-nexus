"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { useLiveEvents, useLiveStatus } from "@/lib/use-live";
import type { ListingCard as Listing } from "@/lib/types";
import { ListingCard } from "./listing-card";

/**
 * A listings grid that stays in sync with the database. The server renders the
 * first paint; when a listing or its photos change anywhere (mobile upload, admin
 * portal), the change feed fires and this re-queries — new homes animate in
 * without a page reload.
 */
export function LiveListings({ initial, query = "", emptyMessage = "No homes match yet.", showCount = false }: { initial: Listing[]; query?: string; emptyMessage?: string; showCount?: boolean }) {
  const [listings, setListings] = useState(initial);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const known = useRef(new Set(initial.map((l) => l.id)));
  const live = useLiveStatus();

  const refetch = useCallback(async () => {
    try {
      const { listings: next } = await api<{ listings: Listing[] }>(`/api/properties${query ? `?${query}` : ""}`);
      const added = next.filter((l) => !known.current.has(l.id)).map((l) => l.id);
      known.current = new Set(next.map((l) => l.id));
      setListings(next);
      if (added.length) {
        setFresh(new Set(added));
        setTimeout(() => setFresh(new Set()), 6000);
      }
    } catch {
      // Keep showing what we have; the next event retries.
    }
  }, [query]);

  // Coalesce bursts (a 20-photo upload fires 20 events) into one refetch.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLiveEvents(
    () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void refetch(), 250);
    },
    (e) => e.table === "properties" || e.table === "media_assets",
  );

  return (
    <div>
      {showCount && (
        <p className="mb-2 text-sm text-ink-2">
          {listings.length} {listings.length === 1 ? "home" : "homes"}
        </p>
      )}
      <p className="mb-6 flex items-center gap-2 text-[0.8125rem] text-ink-3" aria-live="polite">
        <span className={`inline-block size-2 rounded-full ${live ? "bg-success" : "bg-ink-3"}`} aria-hidden />
        {live ? "Live — new listings appear here the moment they're published" : "Connecting to live updates…"}
      </p>
      {listings.length === 0 ? (
        <p className="py-16 text-center text-ink-2">{emptyMessage}</p>
      ) : (
        <motion.ul layout className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {listings.map((listing, i) => (
              <motion.li
                key={listing.id}
                layout
                initial={{ opacity: 0, y: 24, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ type: "spring", bounce: 0, duration: 0.7 }}
                className="relative"
              >
                {fresh.has(listing.id) && (
                  <span className="absolute -top-2 left-5 z-10 rounded-full bg-gold px-3 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-white shadow-sm">
                    Just listed
                  </span>
                )}
                <ListingCard listing={listing} priority={i < 3} />
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}
    </div>
  );
}
