"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ListingForm } from "@/components/admin/listing-form";
import { MediaManager } from "@/components/admin/media-manager";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiClientError } from "@/lib/client-api";
import type { ListingDetail } from "@/lib/types";
import { useLiveEvents } from "@/lib/use-live";

/** Edit a listing. Reloads live if a teammate (or the mobile app) changes it at the same time. */
export default function EditListingPage() {
  const { id } = useParams<{ id: string }>();
  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const { property } = await api<{ property: ListingDetail }>(`/api/properties/${id}`);
      setListing(property);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load the listing.");
    }
  }, [id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);
  useLiveEvents(() => void load(), (e) => e.propertyId === id && e.table === "media_assets");

  return (
    <div>
      <Link href="/admin/listings" className="text-sm text-ink-2 hover:text-ink">← Listings</Link>
      {error && <p className="mt-4 text-danger" role="alert">{error}</p>}
      {!listing ? (
        <Skeleton className="mt-6 h-[600px] w-full rounded-[28px]" />
      ) : (
        <>
          <div className="mt-3 mb-8 flex flex-wrap items-end justify-between gap-4">
            <h1 className="type-title">{listing.title}</h1>
            {listing.status !== "draft" && <Link href={`/listings/${listing.slug}`} target="_blank" className="text-sm underline underline-offset-4">View on site →</Link>}
          </div>
          <MediaManager media={listing.media} onChanged={load} />
          <ListingForm key={listing.id} listing={listing} onSaved={load} />
        </>
      )}
    </div>
  );
}
