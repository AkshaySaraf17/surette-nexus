"use client";

import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { useEffect } from "react";

/**
 * Smooth wheel/trackpad scrolling for the public site (Lenis, MIT). It keeps the
 * browser's native scroll position, so sticky sections, scroll-linked animations
 * and anchors keep working; it simply interpolates wheel steps into continuous
 * motion. Touch devices keep native scrolling. Disabled under Reduce Motion.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ autoRaf: true, anchors: { offset: -72 }, lerp: 0.1, wheelMultiplier: 0.9 });
    (window as unknown as { __lenis?: Lenis }).__lenis = lenis;
    return () => {
      lenis.destroy();
      delete (window as unknown as { __lenis?: Lenis }).__lenis;
    };
  }, []);
  return null;
}
