"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Full-bleed photo slideshow for the hero. Photos cross-fade every few seconds with a
 * slow zoom (opacity + transform only, so it stays on the compositor and never stutters).
 * The first photo loads eagerly; the rest load once the page is idle.
 */
export const HERO_SLIDES = [
  { src: "/media/brand/hero/colonial", alt: "Georgian colonial with a fenced front garden" },
  { src: "/media/brand/hero/queenanne", alt: "Queen Anne Victorian with a wraparound porch" },
  { src: "/media/brand/hero/italianate", alt: "Brick Italianate with tall arched windows" },
  { src: "/media/brand/hero/shingle", alt: "Shingle-style house on a tree-lined street" },
  { src: "/media/brand/hero/gothic", alt: "Gothic Revival cottage in Kennebunkport, Maine" },
];
const INTERVAL_MS = 6500;

export function HeroSlideshow({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [loadRest, setLoadRest] = useState(false);

  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1200));
    const id = idle(() => setLoadRest(true));
    return () => (window.cancelIdleCallback ?? window.clearTimeout)(id as number);
  }, []);

  useEffect(() => {
    if (reduce || !loadRest) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setActive((i) => (i + 1) % HERO_SLIDES.length);
    }, INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [reduce, loadRest]);

  return (
    <div className={cn("absolute inset-0", className)} aria-hidden>
      {HERO_SLIDES.map((slide, i) => {
        if (i > 0 && !loadRest) return null;
        const on = i === active;
        return (
          // eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP renditions
          <img
            key={slide.src}
            src={`${slide.src}.webp`}
            srcSet={`${slide.src}-sm.webp 960w, ${slide.src}.webp 2000w`}
            sizes="100vw"
            alt=""
            loading={i === 0 ? "eager" : "lazy"}
            fetchPriority={i === 0 ? "high" : "low"}
            decoding="async"
            className={cn(
              "absolute inset-0 size-full object-cover transition-opacity duration-[1800ms] ease-in-out will-change-[opacity,transform]",
              on ? "opacity-100" : "opacity-0",
              on && !reduce && "animate-kenburns",
            )}
          />
        );
      })}
    </div>
  );
}
