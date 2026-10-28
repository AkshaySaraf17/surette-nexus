import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ListingFilters } from "@/components/site/listing-filters";
import { LiveListings } from "@/components/site/live-listings";
import { TrackOnMount } from "@/components/site/analytics";
import { Skeleton } from "@/components/ui/skeleton";
import { ANONYMOUS } from "@/lib/server/db";
import { listCities, listListings, type ListingFilters as Filters } from "@/lib/server/listings";

export const metadata: Metadata = { title: "Homes for sale & lease", description: "Every home Surette Real Estate represents in Waterville and Central Maine, updated live." };

const int = (v: string | string[] | undefined) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);
const str = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

async function Results({ searchParams }: { searchParams: PageProps<"/listings">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const sort = str(sp.sort);
  const type = str(sp.type);
  const filters: Filters = {
    q: str(sp.q),
    city: str(sp.city),
    type: type === "sale" || type === "rent" ? type : undefined,
    maxPriceCents: int(sp.maxPrice),
    minBeds: int(sp.minBeds),
    includeSold: sp.sold === "1",
    sort: sort === "newest" || sort === "price_asc" || sort === "price_desc" ? sort : "featured",
    limit: 200,
  };
  const listings = await listListings(ANONYMOUS, filters);
  const query = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && v ? [[k, v]] : []))).toString();
  return (
    <>
    <TrackOnMount key={`idx-${query}`} type="listing_index_view" props={{ results: listings.length }} />
    <LiveListings key={query} initial={listings} query={query} showCount emptyMessage="No homes match these filters. Try widening your search — or ask the AI assistant." />
    </>
  );
}

async function Filters() {
  await connection();
  const cities = await listCities();
  return <ListingFilters cities={cities} />;
}

export default function ListingsPage({ searchParams }: PageProps<"/listings">) {
  return (
    <div data-tone="ivory" className="mx-auto max-w-[1400px] px-5 pb-32 pt-32 sm:px-8">
      <p className="type-eyebrow text-brand">Homes</p>
      <h1 className="type-display mt-3">Available in Central Maine</h1>
      <div className="mt-10">
        <Suspense fallback={<div className="h-16" />}>
          <Filters />
        </Suspense>
      </div>
      <div className="mt-10">
        <Suspense
          fallback={
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="aspect-[4/5] rounded-[28px]" />
              ))}
            </div>
          }
        >
          <Results searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
