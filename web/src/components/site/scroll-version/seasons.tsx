"use client";

import { motion, useTransform } from "motion/react";
import { useScrollProgress } from "@/components/motion/use-scroll-progress";
import { useRef } from "react";

/**
 * A film that opens like an aperture: the autumn river clip starts as a small
 * rounded window and expands to full-bleed as you scroll, while the statement
 * above it fades. Background tone shifts to "dusk" for this section.
 */
export function ScrollSeasons() {
  const ref = useRef<HTMLElement>(null);
  const scrollYProgress = useScrollProgress(ref, ["start end", "end start"]);
  const clip = useTransform(scrollYProgress, [0.15, 0.5], ["inset(18% 24% 18% 24% round 40px)", "inset(0% 0% 0% 0% round 0px)"]);
  const scale = useTransform(scrollYProgress, [0.15, 0.6], [1.25, 1]);
  const textOpacity = useTransform(scrollYProgress, [0.12, 0.3, 0.5], [0, 1, 0]);
  const quoteOpacity = useTransform(scrollYProgress, [0.5, 0.6, 0.78], [0, 1, 0]);

  return (
    <section ref={ref} data-tone="dusk" className="relative h-[220svh]" aria-label="Four seasons in Central Maine">
      <div className="sticky top-0 h-svh overflow-hidden">
        <motion.div className="absolute inset-0" style={{ clipPath: clip }}>
          <motion.video
            className="size-full object-cover"
            style={{ scale }}
            src="/media/brand/autumn-river.mp4"
            poster="/media/brand/autumn-river-poster.webp"
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden
          />
          <div className="absolute inset-0 bg-black/25" aria-hidden />
        </motion.div>
        <motion.div style={{ opacity: textOpacity }} className="pointer-events-none absolute inset-x-0 top-[8%] px-6 text-center">
          <p className="type-eyebrow text-ink-2">Life in Central Maine</p>
          <p className="type-title mx-auto mt-3 max-w-2xl">Rivers, lakes and four honest seasons.</p>
        </motion.div>
        <motion.div style={{ opacity: quoteOpacity }} className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-white">
          <p className="type-display max-w-4xl">October on the water is reason enough to stay.</p>
        </motion.div>
      </div>
    </section>
  );
}
