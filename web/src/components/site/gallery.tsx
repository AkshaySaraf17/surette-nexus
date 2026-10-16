"use client";

import { AnimatePresence, motion, type PanInfo } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Expand } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { MediaImage } from "@/lib/types";
import { ListingImage } from "./listing-image";

/**
 * Listing gallery: an editorial mosaic, and a full-screen lightbox with arrow
 * keys, swipe (velocity-aware: a quick flick advances even if short) and counter.
 */
export function Gallery({ media, title }: { media: MediaImage[]; title: string }) {
  const [index, setIndex] = useState<number | null>(null);
  const [direction, setDirection] = useState(1);
  const count = media.length;

  const go = useCallback(
    (delta: number) => {
      setDirection(delta);
      setIndex((i) => (i === null ? i : (i + delta + count) % count));
    },
    [count],
  );

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, go]);

  if (count === 0) {
    return <div className="grid aspect-[16/9] place-items-center rounded-[32px] bg-fill text-ink-2">Photos coming soon</div>;
  }

  const [first, ...rest] = media;
  const onDragEnd = (_: unknown, info: PanInfo) => {
    const projected = info.offset.x + info.velocity.x * 0.2;
    if (projected < -80) go(1);
    else if (projected > 80) go(-1);
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-4 sm:grid-rows-2">
        <button type="button" onClick={() => setIndex(0)} className="group relative overflow-hidden rounded-[28px] sm:col-span-3 sm:row-span-2" aria-label={`Open photo 1 of ${count}: ${first.alt || title}`}>
          <ListingImage image={first} alt={first.alt || title} priority sizes="(min-width: 640px) 75vw, 100vw" className="aspect-[4/3] size-full transition-transform duration-[1200ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03] sm:aspect-auto" />
        </button>
        {rest.slice(0, 2).map((m, i) => (
          <button key={m.id} type="button" onClick={() => setIndex(i + 1)} className="group relative hidden overflow-hidden rounded-[28px] sm:block" aria-label={`Open photo ${i + 2} of ${count}`}>
            <ListingImage image={m} alt={m.alt || title} sizes="25vw" className="size-full transition-transform duration-[1200ms] group-hover:scale-[1.05]" />
            {i === 1 && count > 3 && (
              <span className="absolute inset-0 grid place-items-center bg-black/40 text-sm font-medium text-white">+{count - 3} photos</span>
            )}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => setIndex(0)} className="pressable mt-4 inline-flex items-center gap-2 text-sm font-medium">
        <Expand className="size-4" aria-hidden /> View all {count} photos
      </button>

      <Dialog open={index !== null} onOpenChange={(open) => !open && setIndex(null)}>
        <DialogContent hideClose={false} className="h-[92dvh] w-[min(1400px,calc(100vw-1rem))] max-w-none overflow-hidden bg-[#0b0a08] p-0 text-white sm:p-0">
          <DialogTitle className="sr-only">{title} — photos</DialogTitle>
          {index !== null && (
            <div className="relative flex h-full flex-col">
              <div className="relative flex-1 overflow-hidden">
                <AnimatePresence initial={false} custom={direction} mode="popLayout">
                  <motion.div
                    key={media[index].id}
                    custom={direction}
                    initial={{ x: `${direction * 100}%`, opacity: 0.4 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: `${direction * -100}%`, opacity: 0.4 }}
                    transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                    drag="x"
                    dragElastic={0.2}
                    dragConstraints={{ left: 0, right: 0 }}
                    onDragEnd={onDragEnd}
                    className="absolute inset-0 grid place-items-center p-4 sm:p-10"
                  >
                    <ListingImage image={media[index]} alt={media[index].alt || title} sizes="100vw" className="max-h-full w-auto rounded-xl !object-contain" />
                  </motion.div>
                </AnimatePresence>
                <button type="button" onClick={() => go(-1)} className="pressable absolute left-4 top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 backdrop-blur hover:bg-white/20" aria-label="Previous photo">
                  <ChevronLeft />
                </button>
                <button type="button" onClick={() => go(1)} className="pressable absolute right-4 top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 backdrop-blur hover:bg-white/20" aria-label="Next photo">
                  <ChevronRight />
                </button>
              </div>
              <p className="px-6 pb-5 text-center text-sm text-white/70" aria-live="polite">
                {index + 1} / {count}
                {media[index].alt ? ` — ${media[index].alt}` : ""}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
