"use client";

import { useState } from "react";
import { Star, Trash2 } from "lucide-react";
import { ListingImage } from "@/components/site/listing-image";
import { api, ApiClientError } from "@/lib/client-api";
import type { MediaImage } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Published photos of a listing: set the cover or delete (both update the public site live). */
export function MediaManager({ media, onChanged }: { media: MediaImage[]; onChanged: () => void | Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function act(id: string, action: "cover" | "delete") {
    if (action === "delete" && !window.confirm("Delete this photo from the listing? This can't be undone.")) return;
    setBusy(id);
    setError("");
    try {
      if (action === "cover") await api(`/api/media/${id}`, { method: "PATCH", body: { isCover: true } });
      else await api(`/api/media/${id}`, { method: "DELETE" });
      await onChanged();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't update the photo.");
    } finally {
      setBusy(null);
    }
  }

  if (media.length === 0) return null;
  return (
    <section className="mb-10 rounded-[28px] bg-paper p-6 ring-1 ring-line sm:p-8" aria-labelledby="published-photos">
      <h2 id="published-photos" className="type-headline">Published photos</h2>
      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
      <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {media.map((m) => (
          <li key={m.id} className={cn("group relative overflow-hidden rounded-2xl ring-2", m.isCover ? "ring-brand" : "ring-transparent", busy === m.id && "opacity-50")}>
            <ListingImage image={m} alt={m.alt} sizes="200px" className="aspect-[4/3] w-full" />
            <div className="absolute inset-x-0 bottom-0 flex justify-between gap-1 bg-gradient-to-t from-black/60 p-2">
              <button type="button" disabled={m.isCover || busy !== null} onClick={() => void act(m.id, "cover")} className="pressable grid size-8 place-items-center rounded-full bg-white/90 text-ink disabled:opacity-60" aria-label={m.isCover ? "Cover photo" : "Make cover photo"}>
                <Star className={cn("size-4", m.isCover && "fill-brand text-brand")} />
              </button>
              <button type="button" disabled={busy !== null} onClick={() => void act(m.id, "delete")} className="pressable grid size-8 place-items-center rounded-full bg-white/90 text-danger" aria-label="Delete photo">
                <Trash2 className="size-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
