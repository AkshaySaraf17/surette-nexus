"use client";

import { useEffect } from "react";

/**
 * A soft light that follows the pointer across the whole site. Position eases
 * toward the pointer every frame (a critically damped follow, so it never
 * overshoots); its color comes from --glare-a, which <ScrollTone/> changes as
 * you scroll. Disabled for touch-only devices and Reduce Motion (CSS).
 */
export function CursorGlare() {
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const root = document.documentElement;
    let targetX = window.innerWidth / 2;
    let targetY = window.innerHeight * 0.3;
    let x = targetX;
    let y = targetY;
    let frame = 0;

    const onMove = (e: PointerEvent) => {
      targetX = e.clientX;
      targetY = e.clientY;
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const tick = () => {
      x += (targetX - x) * 0.14;
      y += (targetY - y) * 0.14;
      root.style.setProperty("--glare-x", `${x.toFixed(1)}px`);
      root.style.setProperty("--glare-y", `${y.toFixed(1)}px`);
      frame = Math.abs(targetX - x) + Math.abs(targetY - y) > 0.5 ? requestAnimationFrame(tick) : 0;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);
  return <div className="cursor-glare" aria-hidden />;
}
