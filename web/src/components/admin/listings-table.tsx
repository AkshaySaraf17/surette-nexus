"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ListingImage } from "@/components/site/listing-image";
import { api, ApiClientError } from "@/lib/client-api";
import { formatPrice, formatRent } from "@/lib/money";
import type { ListingCard } from "@/lib/types";
import { useLiveEvents } from "@/lib/use-live";
import { STATUS_LABEL } from "@/lib/utils";
import { CsvImport } from "./csv-import";

/** Every listing of the team (drafts included), with live updates and one-step status changes. */
export function ListingsTable() {
  const [listings, setListings] = useState<ListingCard[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const { listings } = await api<{ listings: ListingCard[] }>("/api/properties?drafts=1&sort=newest&limit=200");
      setListings(listings);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load listings.");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);
  useLiveEvents(() => void load(), (e) => e.table === "properties" || e.table === "media_assets");

  async function setStatus(id: string, status: string) {
    setListings((all) => all?.map((l) => (l.id === id ? { ...l, status: status as ListingCard["status"] } : l)) ?? null);
    try {
      await api(`/api/properties/${id}`, { method: "PATCH", body: { status } });
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't update.");
      void load();
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="type-title">Listings</h1>
          <p className="mt-1 text-ink-2">Changes publish to the public site instantly.</p>
        </div>
        <Link href="/admin/listings/new" className={buttonVariants({ size: "md" })}><Plus /> New listing</Link>
      </div>
      {error && <p className="mt-4 text-sm text-danger" role="alert">{error}</p>}
      <div className="mt-6"><CsvImport onDone={() => void load()} /></div>
      <div className="mt-6 overflow-hidden rounded-[24px] bg-paper ring-1 ring-line">
        {listings === null ? (
          <div className="space-y-3 p-6">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : listings.length === 0 ? (
          <p className="p-10 text-center text-ink-2">No listings yet. <Link href="/admin/listings/new" className="underline">Create the first one →</Link></p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-[0.75rem] uppercase tracking-[0.1em] text-ink-3">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">Home</th>
                <th scope="col" className="hidden px-5 py-3 font-medium md:table-cell">Price</th>
                <th scope="col" className="hidden px-5 py-3 font-medium sm:table-cell">Photos</th>
                <th scope="col" className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {listings.map((l) => (
                <tr key={l.id} className="hover:bg-fill/50">
                  <td className="px-5 py-3">
                    <Link href={`/admin/listings/${l.id}`} className="flex items-center gap-3">
                      <ListingImage image={l.cover} alt="" sizes="80px" className="h-12 w-16 shrink-0 rounded-lg" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium hover:underline">{l.title}</span>
                        <span className="block truncate text-ink-3">{l.addressLine}, {l.city}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="tabular hidden px-5 py-3 md:table-cell">{l.listingType === "rent" ? formatRent(l.priceCents) : formatPrice(l.priceCents)}</td>
                  <td className="hidden px-5 py-3 sm:table-cell">{l.mediaCount}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <label htmlFor={`st-${l.id}`} className="sr-only">Status of {l.title}</label>
                      <Select id={`st-${l.id}`} value={l.status} onChange={(e) => void setStatus(l.id, e.target.value)} className="h-9 w-40 text-sm">
                        {Object.entries(STATUS_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                      </Select>
                      {l.isFeatured && <Badge tone="brand">Featured</Badge>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
