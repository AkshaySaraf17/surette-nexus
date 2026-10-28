import Link from "next/link";
import { BRAND, BROKERAGE } from "@/lib/site";
import { HeroSearch } from "./hero-search";

/**
 * Home hero: one still photograph in a rounded box with the headline and the home search on top.
 * Nothing moves or changes while scrolling, so the page reads the same for every visitor.
 */
export function Hero() {
  return (
    <section aria-label="Introduction" className="mx-auto max-w-[1400px] px-5 pt-24 sm:px-8">
      <div className="relative overflow-hidden rounded-[28px]">
        {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP renditions */}
        <img
          src="/media/brand/hero/colonial.webp"
          srcSet="/media/brand/hero/colonial-sm.webp 960w, /media/brand/hero/colonial.webp 2000w"
          sizes="(min-width: 1400px) 1400px, 100vw"
          alt="Georgian colonial with a fenced front garden"
          fetchPriority="high"
          className="absolute inset-0 size-full object-cover"
        />
        <div className="absolute inset-0 bg-black/45" aria-hidden />
        <div className="relative flex min-h-[560px] flex-col items-center justify-center px-5 py-16 text-center text-white">
          <p className="type-eyebrow text-white/85">
            {BRAND} Team at <span className="normal-case">{BROKERAGE}</span> · Waterville, Maine
          </p>
          <h1 className="type-hero mt-5 max-w-5xl">Homes with a sense of place.</h1>
          <p className="type-lede mt-5 max-w-xl text-white/90">
            Central Maine&rsquo;s homes, lake houses and land, represented by a team that has lived here for generations.
          </p>
          <HeroSearch />
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[0.9375rem] text-white/90">
            <Link href="/dual-move" className="underline underline-offset-4">Selling and buying? Plan both moves →</Link>
            <Link href="/market" className="underline underline-offset-4">Central Maine market snapshot →</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
