"use client";

import { useScroll, useTransform, type MotionValue } from "motion/react";
import type { RefObject } from "react";

type Offset = NonNullable<Parameters<typeof useScroll>[0]>["offset"];

/**
 * Scroll progress (0 → 1) of `target` through the viewport, computed in JavaScript.
 *
 * Motion can hand `useScroll` values straight to the browser's native ScrollTimeline
 * for some properties; that path ignores custom offsets for targeted sections and left
 * the hero half-faded at the top of the page. Passing the value through a function
 * transform keeps every scroll-linked style on the exact offsets we specify, while
 * still updating on the compositor-friendly rAF loop.
 */
export function useScrollProgress(target: RefObject<HTMLElement | null>, offset: Offset): MotionValue<number> {
  const { scrollYProgress } = useScroll({ target, offset });
  return useTransform(() => scrollYProgress.get());
}
