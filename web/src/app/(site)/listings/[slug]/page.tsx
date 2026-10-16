import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Bath, BedDouble, CalendarRange, Car, Footprints, GraduationCap, Maximize, Trees } from "lucide-react";
import { Reveal } from "@/components/motion/reveal";
import { AgentPortrait } from "@/components/site/agent-portrait";
import { ConciergeButton } from "@/components/site/concierge-button";
import { Gallery } from "@/components/site/gallery";
import { CompareToggle } from "@/components/site/compare-toggle";
import { LiveRefresh } from "@/components/site/live-refresh";
import { TrackOnMount } from "@/components/site/analytics";
import { SaveButton } from "@/components/site/save-button";
import { ShowingRequest } from "@/components/site/showing-request";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { COMMUTE_ANCHORS, SCHOOLS, distanceKm, estimateDriveMinutes, walkIndexLabel, type LngLat } from "@/lib/geo";
import { formatCents, formatPrice, formatRent } from "@/lib/money";
import { getViewerFromCookies, contextFor } from "@/lib/server/auth";
import { ANONYMOUS } from "@/lib/server/db";
import { getListingBySlug } from "@/lib/server/listings";
import { formatAcres, formatBaths, STATUS_LABEL } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/listings/[slug]">): Promise<Metadata> {
  await connection();
  const { slug } = await params;
  const listing = await getListingBySlug(ANONYMOUS, slug);
  if (!listing) return { title: "Listing not found" };
  return {
    title: `${listing.title}, ${listing.city}`,
    description: listing.headline ?? listing.description.slice(0, 160),
    openGraph: { images: listing.cover ? [listing.cover.variants.md?.url ?? listing.cover.url] : [] },
  };
}

async function ListingView({ params }: { params: PageProps<"/listings/[slug]">["params"] }) {
  await connection();
  const { slug } = await params;
  const viewer = await getViewerFromCookies();
  const listing = await getListingBySlug(contextFor(viewer), slug);
  if (!listing) notFound();

  const pos: LngLat | null = listing.longitude !== null && listing.latitude !== null ? [listing.longitude, listing.latitude] : null;
  const nearbySchools = pos
    ? SCHOOLS.filter((s) => s.level !== "College")
        .map((s) => ({ ...s, km: distanceKm(pos, s.position) }))
        .sort((a, b) => a.km - b.km)
        .slice(0, 4)
    : [];
  const price = listing.listingType === "rent" ? formatRent(listing.priceCents) : formatPrice(listing.priceCents);
  const facts = [
    { icon: BedDouble, label: "Bedrooms", value: String(listing.bedrooms) },
    { icon: Bath, label: "Bathrooms", value: `${listing.fullBaths} full${listing.halfBaths ? ` · ${listing.halfBaths} half` : ""}` },
    { icon: Maximize, label: "Interior", value: listing.livingAreaSqft ? `${listing.livingAreaSqft.toLocaleString("en-US")} sq ft` : "—" },
    { icon: Trees, label: "Land", value: formatAcres(listing.lotSizeSqft) ?? "—" },
    { icon: CalendarRange, label: "Built", value: listing.yearBuilt ? String(listing.yearBuilt) : "—" },
  ];

  return (
    <article>
      <LiveRefresh propertyId={listing.id} />
      <TrackOnMount key={listing.id} type="property_view" props={{ property_id: listing.id }} />
      <nav aria-label="Breadcrumb" className="text-[0.8125rem] text-ink-3">
        <Link href="/listings" className="hover:text-ink">Homes</Link> <span aria-hidden>/</span> {listing.city}
      </nav>
      <header className="mt-6 flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone={listing.status === "active" ? "success" : listing.status === "pending" ? "warn" : "neutral"}>{STATUS_LABEL[listing.status]}</Badge>
            {listing.listingType === "rent" && <Badge tone="gold">For lease</Badge>}
          </div>
          <h1 className="type-display mt-4">{listing.title}</h1>
          <p className="mt-3 text-ink-2">
            {listing.addressLine}, {listing.city}, {listing.state} {listing.postalCode}
          </p>
          <p className="mt-1 text-[0.8125rem] text-ink-3">
            {listing.source === "demo" ? "Demo listing (fictional address, illustrative photos)" : "Surette Real Estate listing"} · status confirmed {new Date(listing.statusVerifiedAt).toLocaleDateString("en-US")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="type-title tabular">{price}</p>
          <SaveButton propertyId={listing.id} title={listing.title} tone="dark" />
        </div>
      </header>

      <div className="mt-10">
        <Gallery media={listing.media} title={listing.title} />
      </div>

      <div className="mt-16 grid gap-16 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <dl className="grid grid-cols-2 gap-6 border-y border-line py-8 sm:grid-cols-5">
            {facts.map(({ icon: Icon, label, value }) => (
              <div key={label}>
                <dt className="flex items-center gap-1.5 type-eyebrow text-ink-3"><Icon className="size-3.5" aria-hidden />{label}</dt>
                <dd className="mt-2 text-lg">{value}</dd>
              </div>
            ))}
          </dl>

          {listing.headline && <p className="type-title mt-14 max-w-3xl">{listing.headline}</p>}
          <div className="mt-8 max-w-3xl space-y-5 text-[1.0625rem] leading-relaxed text-ink-2">
            {listing.description.split(/\n{2,}/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>

          {listing.amenities.length > 0 && (
            <Reveal className="mt-16">
              <h2 className="type-headline">Amenities</h2>
              <ul className="mt-6 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {listing.amenities.map((a) => (
                  <li key={a} className="flex items-center gap-3 border-b border-line pb-3"><span className="size-1.5 rounded-full bg-gold" aria-hidden />{a}</li>
                ))}
              </ul>
            </Reveal>
          )}

          {Object.keys(listing.structuralFeatures).length > 0 && (
            <Reveal className="mt-16">
              <h2 className="type-headline">Structure &amp; systems</h2>
              <dl className="mt-6 divide-y divide-line border-y border-line">
                {Object.entries(listing.structuralFeatures).map(([k, v]) => (
                  <div key={k} className="grid grid-cols-3 gap-4 py-3.5">
                    <dt className="text-ink-3">{k}</dt>
                    <dd className="col-span-2">{v}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          )}

          <Reveal className="mt-16">
            <h2 className="type-headline">The neighborhood</h2>
            <div className="mt-6 grid gap-6 sm:grid-cols-3">
              <div className="rounded-3xl bg-paper p-6 ring-1 ring-line">
                <GraduationCap className="size-5 text-gold" aria-hidden />
                <p className="mt-3 font-medium">{listing.schoolDistrict ?? "District on request"}</p>
                <ul className="mt-3 space-y-1.5 text-sm text-ink-2">
                  {nearbySchools.map((s) => (
                    <li key={s.name}>{s.name} · {s.km < 1 ? `${Math.round(s.km * 1000)} m` : `${s.km.toFixed(1)} km`}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-3xl bg-paper p-6 ring-1 ring-line">
                <Car className="size-5 text-gold" aria-hidden />
                <p className="mt-3 font-medium">Estimated drives</p>
                <ul className="mt-3 space-y-1.5 text-sm text-ink-2">
                  {pos && COMMUTE_ANCHORS.slice(0, 4).map((a) => (
                    <li key={a.id}>{a.name.split(" (")[0]} · ~{estimateDriveMinutes(pos, a.position)} min</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-3xl bg-paper p-6 ring-1 ring-line">
                <Footprints className="size-5 text-gold" aria-hidden />
                <p className="mt-3 font-medium">Walk Index {listing.walkScore ?? "—"}</p>
                {listing.walkScore !== null && (
                  <>
                    <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-fill" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={listing.walkScore} aria-label="Walk Index">
                      <div className="h-full rounded-full bg-gold" style={{ width: `${listing.walkScore}%` }} />
                    </div>
                    <p className="mt-3 text-sm text-ink-2">{walkIndexLabel(listing.walkScore)}</p>
                  </>
                )}
              </div>
            </div>
            <Link href={`/map?focus=${listing.slug}`} className="mt-6 inline-block text-sm font-medium underline underline-offset-4">See it on the map with school &amp; commute layers →</Link>
          </Reveal>
        </div>

        <aside className="lg:col-span-4">
          <div className="sticky top-24 space-y-5">
            <div className="rounded-[28px] bg-paper p-6 shadow-sm ring-1 ring-line">
              <p className="type-eyebrow text-ink-3">{listing.listingType === "rent" ? "Monthly rent" : "Offered at"}</p>
              <p className="type-title tabular mt-2">{price}</p>
              <dl className="mt-4 space-y-1.5 text-sm text-ink-2">
                {listing.taxAnnualCents > 0 && <div className="flex justify-between"><dt>Annual taxes</dt><dd className="tabular">{formatCents(listing.taxAnnualCents)}</dd></div>}
                {listing.hoaMonthlyCents > 0 && <div className="flex justify-between"><dt>HOA / month</dt><dd className="tabular">{formatCents(listing.hoaMonthlyCents)}</dd></div>}
                <div className="flex justify-between"><dt>Bed / bath</dt><dd>{listing.bedrooms} / {formatBaths(listing.fullBaths, listing.halfBaths)}</dd></div>
              </dl>
              <div className="mt-6 space-y-2.5">
                {listing.status === "active" ? (
                  <ShowingRequest propertyId={listing.id} title={listing.title} />
                ) : (
                  <p className="rounded-2xl bg-fill p-4 text-sm text-ink-2">This home is {STATUS_LABEL[listing.status].toLowerCase()}. Ask the concierge about similar homes.</p>
                )}
                <CompareToggle propertyId={listing.id} />
                <div className="[&>button]:w-full">
                  <ConciergeButton prompt={`Tell me more about ${listing.title} — schools, commute and what's nearby.`}>Ask the concierge</ConciergeButton>
                </div>
              </div>
            </div>
            {listing.agent && (
              <div className="flex items-center gap-4 rounded-[28px] bg-paper p-5 ring-1 ring-line">
                <AgentPortrait agent={listing.agent} className="size-16 shrink-0 rounded-2xl text-xl [&>span]:text-xl" />
                <div className="min-w-0">
                  <p className="font-medium">{listing.agent.fullName}</p>
                  <p className="text-sm text-ink-2">{listing.agent.title}</p>
                  {listing.agent.phone && <a href={`tel:${listing.agent.phone}`} className="text-sm underline underline-offset-4">{listing.agent.phone}</a>}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </article>
  );
}

export default function ListingPage({ params }: PageProps<"/listings/[slug]">) {
  return (
    <div data-tone="paper" className="mx-auto max-w-[1400px] px-5 pb-32 pt-28 sm:px-8">
      <Suspense
        fallback={
          <div className="space-y-6">
            <Skeleton className="h-12 w-2/3" />
            <Skeleton className="aspect-[16/8] w-full rounded-[28px]" />
          </div>
        }
      >
        <ListingView params={params} />
      </Suspense>
    </div>
  );
}
