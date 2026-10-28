"use client";

import { motion, useReducedMotion, useTransform } from "motion/react";
import { useScrollProgress } from "@/components/motion/use-scroll-progress";
import Link from "next/link";
import { useRef } from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { HeroSearch } from "../hero-search";
import { HeroSlideshow } from "../hero-slideshow";

/**
 * Home hero. A slideshow of New England homes plays full-bleed; as you
 * scroll, it settles back into a framed card (inset + rounded corners),
 * the headline drifts up and dissolves, and a second line resolves in — all
 * scrubbed 1:1 with the scroll position (reversible, interruptible).
 */
export function ScrollHero() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const scrollYProgress = useScrollProgress(ref, ["start start", "end start"]);

  const inset = useTransform(scrollYProgress, [0, 0.55], ["0%", reduce ? "0%" : "5%"]);
  const radius = useTransform(scrollYProgress, [0, 0.55], [0, reduce ? 0 : 36]);
  const scale = useTransform(scrollYProgress, [0, 1], [1.08, 1]);
  const headlineY = useTransform(scrollYProgress, [0, 0.4], ["0%", "-40%"]);
  const headlineOpacity = useTransform(scrollYProgress, [0, 0.32], [1, 0]);
  const headlineBlur = useTransform(scrollYProgress, [0, 0.32], ["blur(0px)", "blur(10px)"]);
  const secondOpacity = useTransform(scrollYProgress, [0.35, 0.55, 0.85], [0, 1, 1]);
  const secondY = useTransform(scrollYProgress, [0.35, 0.55], [40, 0]);
  const shade = useTransform(scrollYProgress, [0, 0.5], [0.28, 0.55]);

  return (
    <section ref={ref} data-tone="night" className="relative h-[200svh]" aria-label="Introduction">
      <div className="sticky top-0 h-svh overflow-hidden">
        <motion.div className="absolute overflow-hidden" style={{ inset, borderRadius: radius }}>
          <motion.div className="absolute inset-0" style={{ scale }}>
            <HeroSlideshow />
          </motion.div>
          <motion.div className="absolute inset-0 bg-black" style={{ opacity: shade }} aria-hidden />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 to-transparent" aria-hidden />
        </motion.div>

        <motion.div
          className="relative z-10 flex h-full flex-col items-center justify-center px-5 text-center text-white"
          style={{ y: headlineY, opacity: headlineOpacity, filter: headlineBlur }}
        >
          <p className="type-eyebrow text-white/75">Surette Real Estate · Waterville, Maine</p>
          <h1 className="type-hero mt-6 max-w-5xl">
            Homes with a <em className="font-light italic text-brand-soft">sense</em> of place.
          </h1>
          <p className="type-lede mt-6 max-w-xl text-white/85">
            Central Maine&rsquo;s finest homes, lake houses and land — represented by a team that has lived here for generations.
          </p>
          <HeroSearch />
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/80">
            <Link href="/dual-move" className="underline-offset-4 hover:underline">Selling and buying? Plan both moves →</Link>
            <Link href="/market" className="underline-offset-4 hover:underline">Central Maine market snapshot →</Link>
          </div>
        </motion.div>

        <motion.div
          className="pointer-events-none absolute inset-x-0 bottom-[18%] z-10 px-5 text-center text-white"
          style={{ opacity: secondOpacity, y: secondY }}
        >
          <p className="type-display mx-auto max-w-4xl">Every room, every view, before you arrive.</p>
        </motion.div>

        <motion.a
          href="#intro"
          style={{ opacity: headlineOpacity }}
          className={cn("absolute bottom-8 left-1/2 z-10 grid size-11 -translate-x-1/2 place-items-center rounded-full border border-white/30 text-white/80")}
          aria-label="Scroll to continue"
        >
          <motion.span animate={reduce ? undefined : { y: [0, 6, 0] }} transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}>
            <ArrowDown className="size-4" />
          </motion.span>
        </motion.a>
      </div>
    </section>
  );
}
