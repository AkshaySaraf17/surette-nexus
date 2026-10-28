import type { Metadata } from "next";
import Link from "next/link";
import { CursorGlare } from "@/components/motion/cursor-glare";
import { Parallax } from "@/components/motion/parallax-animated";
import { Reveal, RevealWords } from "@/components/motion/reveal-animated";
import { ScrollTone } from "@/components/motion/scroll-tone";
import { SmoothScroll } from "@/components/motion/smooth-scroll";
import { AssistantButton } from "@/components/site/assistant-button";
import { ScrollHero } from "@/components/site/scroll-version/hero";
import { ScrollScenes } from "@/components/site/scroll-version/scenes";
import { ScrollSeasons } from "@/components/site/scroll-version/seasons";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Scroll version",
  description: "The earlier, scroll-animated version of the home page, kept so it can be compared with the simpler design.",
};

/**
 * The earlier home page, with its scroll effects, kept for side-by-side comparison with the
 * simpler main home page (smooth scrolling, colour that changes per section, a cursor glow,
 * a hero that shrinks into a card, full-screen photos that slide over each other, a film that
 * opens as you scroll, and text that fades in). The effects only run on this page.
 */
export default function ScrollVersionPage() {
  return (
    <>
      <SmoothScroll />
      <ScrollTone />
      <CursorGlare />

      <section data-tone="ivory" aria-labelledby="compare-heading" className="mx-auto max-w-[1400px] px-5 pb-10 pt-28 sm:px-8">
        <div className="rounded-[24px] bg-paper p-6 ring-1 ring-line sm:p-8">
          <p className="type-eyebrow text-brand">For comparison</p>
          <h2 id="compare-heading" className="type-title mt-2">The earlier, scroll-animated home page</h2>
          <p className="mt-3 max-w-3xl text-ink-2">
            This is how the home page looked before it was simplified. Keep scrolling: the opening photo shrinks into a card, photos slide over each
            other, a film opens up, colours change from section to section and text fades in. The main home page shows the same content in simple
            boxes that scroll normally, which is easier for most visitors to follow.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/" className={buttonVariants({ variant: "primary" })}>
              See the simple version
            </Link>
          </div>
        </div>
      </section>

      <ScrollHero />

      <section id="intro" data-tone="ivory" className="mx-auto max-w-[1400px] px-5 py-32 sm:px-8 sm:py-44">
        <p className="type-eyebrow text-brand">Since 1978</p>
        <RevealWords as="h2" className="type-display mt-6 max-w-5xl" text="Waterville, the Belgrade Lakes and the Kennebec Valley — represented by people who live here." />
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

      <ScrollScenes />

      <ScrollSeasons />

      <section data-tone="ivory" className="relative overflow-hidden">
        <Parallax strength={10} className="h-[70svh]">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand still */}
          <img src="/media/brand/lake-foliage.webp" srcSet="/media/brand/lake-foliage-sm.webp 960w, /media/brand/lake-foliage.webp 2000w" sizes="100vw" alt="Autumn trees reflected in still water" loading="lazy" className="size-full object-cover" />
        </Parallax>
        <div className="absolute inset-0 grid place-items-center bg-black/35 px-5 text-center text-white">
          <Reveal>
            <h2 className="type-display mx-auto max-w-3xl">Looking for something not yet listed?</h2>
            <p className="type-lede mx-auto mt-5 max-w-xl text-white/85">Tell the AI assistant what you have in mind. Our team hears about homes before they reach the market.</p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <AssistantButton variant="brand" prompt="I'm looking for a home that isn't listed yet.">
                Start a private search
              </AssistantButton>
              <Link href="/" className={buttonVariants({ variant: "glass", size: "lg" })}>
                Back to the simple version
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
