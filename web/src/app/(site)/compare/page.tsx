import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ListingImage } from "@/components/site/listing-image";
import { CompareActions } from "@/components/site/compare-actions";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents, formatPrice, formatRent } from "@/lib/money";
import { ANONYMOUS } from "@/lib/server/db";
import { getListingById } from "@/lib/server/listings";
import { formatAcres, formatBaths, STATUS_LABEL } from "@/lib/utils";

export const metadata: Metadata = { title: "Compare homes" };

async function Comparison({ searchParams }: { searchParams: PageProps<"/compare">["searchParams"] }) {
  await connection();
  const { ids } = await searchParams;
  const list = (typeof ids === "string" ? ids.split(",") : []).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 4);
  const homes = (await Promise.all(list.map((id) => getListingById(ANONYMOUS, id)))).filter((x) => x !== null);
  if (homes.length < 2) {
    return <p className="rounded-[24px] bg-paper p-8 text-ink-2 ring-1 ring-line">Choose at least two homes to compare — use &ldquo;Compare&rdquo; on listing pages or ask the AI assistant. <Link href="/listings" className="underline">Browse homes →</Link></p>;
  }
  const rows: [string, (h: (typeof homes)[number]) => string][] = [
    ["Price", (h) => (h.listingType === "rent" ? formatRent(h.priceCents) : formatPrice(h.priceCents))],
    ["Status", (h) => STATUS_LABEL[h.status]],
    ["Town", (h) => h.city],
    ["Bedrooms", (h) => String(h.bedrooms)],
    ["Bathrooms", (h) => `${formatBaths(h.fullBaths, h.halfBaths)} (${h.fullBaths} full, ${h.halfBaths} half)`],
    ["Interior", (h) => (h.livingAreaSqft ? `${h.livingAreaSqft.toLocaleString("en-US")} sq ft` : "—")],
    ["Price per sq ft", (h) => (h.livingAreaSqft && h.listingType === "sale" ? formatCents(Math.round(h.priceCents / h.livingAreaSqft)) : "—")],
    ["Land", (h) => formatAcres(h.lotSizeSqft) ?? "—"],
    ["Garage", (h) => (h.garageSpaces ? `${h.garageSpaces}-car` : "None listed")],
    ["Year built", (h) => (h.yearBuilt ? String(h.yearBuilt) : "—")],
    ["Annual taxes", (h) => (h.taxAnnualCents ? formatCents(h.taxAnnualCents) : "—")],
    ["School district", (h) => h.schoolDistrict ?? "—"],
    ["Walk Index (estimate)", (h) => (h.walkScore !== null ? String(h.walkScore) : "—")],
    ["Source", (h) => `${h.source === "demo" ? "Demo listing" : "Surette listing"} · status confirmed ${new Date(h.statusVerifiedAt).toLocaleDateString("en-US")}`],
  ];
  return (
    <>
      <div className="overflow-x-auto rounded-[28px] bg-paper ring-1 ring-line">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr>
              <th className="w-44" />
              {homes.map((h) => (
                <th key={h.id} scope="col" className="p-4 text-left align-top font-normal">
                  <Link href={`/listings/${h.slug}`} className="group block">
                    <ListingImage image={h.cover} alt={h.title} sizes="300px" className="aspect-[4/3] w-full rounded-2xl" />
                    <span className="type-headline mt-3 block group-hover:underline">{h.title}</span>
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(([label, value]) => (
              <tr key={label}><th scope="row" className="px-4 py-3 text-left font-normal text-ink-3">{label}</th>{homes.map((h) => <td key={h.id} className="px-4 py-3">{value(h)}</td>)}</tr>
            ))}
            <tr><th scope="row" className="px-4 py-3 text-left font-normal text-ink-3">Amenities</th>{homes.map((h) => <td key={h.id} className="px-4 py-3 text-ink-2">{h.amenities.join(", ") || "—"}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <CompareActions ids={homes.map((h) => h.id)} />
    </>
  );
}

export default function ComparePage({ searchParams }: PageProps<"/compare">) {
  return (
    <div data-tone="paper" className="mx-auto max-w-[1400px] px-5 pb-32 pt-32 sm:px-8">
      <p className="type-eyebrow text-gold">Compare</p>
      <h1 className="type-display mt-3">Side by side</h1>
      <div className="mt-10">
        <Suspense fallback={<Skeleton className="h-96 w-full rounded-[28px]" />}>
          <Comparison searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
