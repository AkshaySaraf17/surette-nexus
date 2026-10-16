import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { MapExplorer } from "@/components/site/map-explorer";
import { ANONYMOUS } from "@/lib/server/db";
import { listListings } from "@/lib/server/listings";

export const metadata: Metadata = { title: "Map", description: "Listings with school district, commute and walkability layers for Waterville and Central Maine." };

async function MapData({ searchParams }: { searchParams: PageProps<"/map">["searchParams"] }) {
  await connection();
  const [{ focus }, listings] = await Promise.all([searchParams, listListings(ANONYMOUS, { limit: 200, includeSold: true })]);
  return <MapExplorer initial={listings} focusSlug={typeof focus === "string" ? focus : undefined} />;
}

export default function MapPage({ searchParams }: PageProps<"/map">) {
  return (
    <div data-tone="paper" className="pt-16">
      <h1 className="sr-only">Map of homes and neighborhoods</h1>
      <Suspense fallback={<div className="h-[calc(100svh-4rem)] animate-pulse bg-fill" />}>
        <MapData searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
