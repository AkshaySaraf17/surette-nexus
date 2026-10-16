import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { GraduationCap, Car, Footprints } from "lucide-react";
import { Parallax } from "@/components/motion/parallax";
import { Reveal, RevealWords } from "@/components/motion/reveal";
import { AgentPortrait } from "@/components/site/agent-portrait";
import { ConciergeButton } from "@/components/site/concierge-button";
import { Featured } from "@/components/site/featured";
import { Hero } from "@/components/site/hero";
import { LiveListings } from "@/components/site/live-listings";
import { HomeScenes } from "@/components/site/home-scenes";
import { Seasons } from "@/components/site/seasons";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ANONYMOUS } from "@/lib/server/db";
import { listListings, listTeamMembers } from "@/lib/server/listings";

/**
 * Home. Routing budget: every active listing is rendered in "Available now"
 * on this page, so any listing is ONE click away from home (two at most via
 * Homes → card). The grid is live: new uploads appear without a reload.
 */

async function FeaturedSection() {
  await connection();
  const listings = await listListings(ANONYMOUS, { featuredOnly: true, limit: 3 });
  if (listings.length === 0) return null;
  return <Featured listings={listings} />;
}

async function AvailableSection() {
  await connection();
  const listings = await listListings(ANONYMOUS, { sort: "featured", limit: 200 });
  return <LiveListings initial={listings} emptyMessage="New homes are on their way. Ask the concierge to alert you." />;
}

async function LeaderSection() {
  await connection();
  const [leader] = await listTeamMembers();
  if (!leader) return null;
  return (
    <div className="grid items-center gap-12 lg:grid-cols-12">
      <Reveal className="lg:col-span-5">
        <AgentPortrait agent={leader} className="aspect-[4/5] w-full rounded-[32px] shadow-lg" />
      </Reveal>
      <Reveal className="lg:col-span-6 lg:col-start-7" delay={0.1}>
        <p className="type-eyebrow text-gold">{leader.title}</p>
        <h2 className="type-display mt-4">{leader.fullName}</h2>
        {leader.bio && <p className="type-lede mt-6 text-ink-2">{leader.bio}</p>}
        {leader.specialties.length > 0 && (
          <ul className="mt-8 flex flex-wrap gap-2">
            {leader.specialties.map((s) => (
              <li key={s} className="rounded-full border border-line-strong px-3.5 py-1.5 text-[0.8125rem]">
                {s}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/team" className={buttonVariants({ variant: "primary", size: "lg" })}>
            Meet the team
          </Link>
          <ConciergeButton prompt={`I'd like to speak with ${leader.fullName} about buying a home.`}>Ask for {leader.fullName.split(" ")[0]}</ConciergeButton>
        </div>
      </Reveal>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="aspect-[4/5] rounded-[28px]" />
      ))}
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <Hero />

      <section id="intro" data-tone="ivory" className="mx-auto max-w-[1400px] px-5 py-32 sm:px-8 sm:py-44">
        <p className="type-eyebrow text-gold">Since 1978</p>
        <RevealWords
          as="h2"
          className="type-display mt-6 max-w-5xl"
          text="Waterville, the Belgrade Lakes and the Kennebec Valley — represented by people who live here."
        />
        <div className="mt-20 grid gap-10 border-t border-line pt-10 sm:grid-cols-3">
          {[
            { k: "Homes & estates", v: "Historic colonials to lakefront glass houses, photographed inside and out." },
            { k: "Waterfront & land", v: "Frontage, acreage and farms across Kennebec and Somerset counties." },
            { k: "Leasing & management", v: "Rentals and portfolio management backed by our operations team." },
          ].map((item, i) => (
            <Reveal key={item.k} delay={i * 0.08}>
              <h3 className="type-headline">{item.k}</h3>
              <p className="mt-3 text-ink-2">{item.v}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section data-tone="paper" aria-labelledby="featured-heading" className="mx-auto max-w-[1400px] px-5 pb-40 sm:px-8">
        <div className="mb-20 flex items-end justify-between gap-6">
          <h2 id="featured-heading" className="type-title">
            Featured residences
          </h2>
          <Link href="/listings" className="text-sm font-medium underline-offset-4 hover:underline">
            All homes →
          </Link>
        </div>
        <Suspense fallback={<Skeleton className="aspect-[16/9] w-full rounded-[32px]" />}>
          <FeaturedSection />
        </Suspense>
      </section>

      <HomeScenes />

      <section id="available" data-tone="ivory" aria-labelledby="available-heading" className="mx-auto max-w-[1400px] px-5 py-32 sm:px-8">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="type-eyebrow text-gold">Available now</p>
            <h2 id="available-heading" className="type-display mt-3">
              Every home we represent.
            </h2>
          </div>
          <Link href="/listings" className={buttonVariants({ variant: "outline" })}>
            Filter &amp; sort
          </Link>
        </div>
        <Suspense fallback={<GridSkeleton />}>
          <AvailableSection />
        </Suspense>
      </section>

      <section data-tone="navy" aria-labelledby="map-heading" className="relative overflow-hidden py-32 text-white">
        <div className="mx-auto grid max-w-[1400px] items-center gap-14 px-5 sm:px-8 lg:grid-cols-2">
          <Reveal>
            <p className="type-eyebrow text-white/60">Know the neighborhood</p>
            <h2 id="map-heading" className="type-display mt-4">
              Schools, commutes and walkability — layered on one map.
            </h2>
            <ul className="mt-10 space-y-5 text-white/80">
              <li className="flex gap-4">
                <GraduationCap className="mt-1 size-5 shrink-0 text-gold-soft" aria-hidden /> District areas and every public school, elementary to high school.
              </li>
              <li className="flex gap-4">
                <Car className="mt-1 size-5 shrink-0 text-gold-soft" aria-hidden /> Commute rings to downtown, Colby, MaineGeneral, Augusta and Portland.
              </li>
              <li className="flex gap-4">
                <Footprints className="mt-1 size-5 shrink-0 text-gold-soft" aria-hidden /> A walkability heat layer built from everyday destinations.
              </li>
            </ul>
            <Link href="/map" className={`${buttonVariants({ variant: "gold", size: "lg" })} mt-10`}>
              Open the map
            </Link>
          </Reveal>
          <Reveal delay={0.1}>
            <Parallax strength={6} className="aspect-[4/3] rounded-[32px]">
              {/* eslint-disable-next-line @next/next/no-img-element -- static brand still */}
              <img src="/media/brand/two-cent-bridge.webp" alt="The Two Cent Bridge over the Kennebec River in Waterville" className="size-full object-cover" />
            </Parallax>
          </Reveal>
        </div>
      </section>

      <Seasons />

      <section data-tone="gold" aria-label="Team leader" className="mx-auto max-w-[1400px] px-5 py-36 sm:px-8">
        <Suspense fallback={<Skeleton className="h-[480px] w-full rounded-[32px]" />}>
          <LeaderSection />
        </Suspense>
      </section>

      <section data-tone="ivory" className="relative overflow-hidden">
        <Parallax strength={10} className="h-[70svh]">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand still */}
          <img src="/media/brand/lake-foliage.webp" srcSet="/media/brand/lake-foliage-sm.webp 960w, /media/brand/lake-foliage.webp 2000w" sizes="100vw" alt="Autumn trees reflected in still water" loading="lazy" className="size-full object-cover" />
        </Parallax>
        <div className="absolute inset-0 grid place-items-center bg-black/35 px-5 text-center text-white">
          <Reveal>
            <h2 className="type-display mx-auto max-w-3xl">Looking for something not yet listed?</h2>
            <p className="type-lede mx-auto mt-5 max-w-xl text-white/85">Tell the concierge what you have in mind. Our team hears about homes before they reach the market.</p>
            <div className="mt-9">
              <ConciergeButton variant="gold" prompt="I'm looking for a home that isn't listed yet.">
                Start a private search
              </ConciergeButton>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
