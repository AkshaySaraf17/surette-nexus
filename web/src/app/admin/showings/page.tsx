"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiClientError } from "@/lib/client-api";
import type { Showing, ShowingStatus } from "@/lib/types";
import { useLiveEvents } from "@/lib/use-live";

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const TONE: Record<ShowingStatus, "warn" | "success" | "neutral" | "danger"> = { requested: "warn", confirmed: "success", completed: "neutral", cancelled: "danger" };

/** Showing requests from the website, concierge and mobile app. Confirming checks for overlaps in the database. */
export default function ShowingsPage() {
  const [showings, setShowings] = useState<Showing[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setShowings((await api<{ showings: Showing[] }>("/api/showings")).showings);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load showings.");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);
  useLiveEvents(() => void load(), (e) => e.table === "showings");

  async function update(id: string, status: ShowingStatus) {
    setError("");
    try {
      await api(`/api/showings/${id}`, { method: "PATCH", body: { status } });
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't update.");
    }
  }

  return (
    <div>
      <h1 className="type-title">Showings</h1>
      <p className="mt-1 text-ink-2">New requests appear here the moment they&rsquo;re made.</p>
      {error && <p className="mt-4 text-sm text-danger" role="alert">{error}</p>}
      <div className="mt-8 space-y-3">
        {showings === null ? (
          Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24" />)
        ) : showings.length === 0 ? (
          <p className="rounded-[24px] bg-paper p-10 text-center text-ink-2 ring-1 ring-line">No upcoming showings.</p>
        ) : (
          showings.map((s) => (
            <article key={s.id} className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] bg-paper p-5 ring-1 ring-line">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge tone={TONE[s.status]}>{s.status}</Badge>
                  <span className="text-[0.75rem] uppercase tracking-[0.1em] text-ink-3">via {s.source}</span>
                </div>
                <p className="mt-2 font-medium">{when(s.startsAt)} · <Link href={`/listings/${s.propertySlug}`} className="underline underline-offset-4">{s.propertyTitle}</Link></p>
                <p className="text-sm text-ink-2">
                  {s.contactName} · <a href={`mailto:${s.contactEmail}`} className="underline">{s.contactEmail}</a>
                  {s.contactPhone && <> · <a href={`tel:${s.contactPhone}`} className="underline">{s.contactPhone}</a></>}
                  {s.agentName && <> · Agent: {s.agentName}</>}
                </p>
                {s.notes && <p className="mt-1 text-sm text-ink-3">“{s.notes}”</p>}
              </div>
              <div className="flex gap-2">
                {s.status === "requested" && <Button size="sm" onClick={() => void update(s.id, "confirmed")}>Confirm</Button>}
                {s.status === "confirmed" && <Button size="sm" variant="outline" onClick={() => void update(s.id, "completed")}>Mark done</Button>}
                {(s.status === "requested" || s.status === "confirmed") && <Button size="sm" variant="ghost" onClick={() => void update(s.id, "cancelled")}>Cancel</Button>}
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
