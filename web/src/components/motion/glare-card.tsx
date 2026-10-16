"use client";

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useRef, type ReactNode, type PointerEvent } from "react";
import { cn } from "@/lib/utils";

/**
 * A card that tilts toward the pointer and catches a specular highlight where
 * the light "hits" it. Springs start from the current on-screen value, so moving
 * in, out and across never jumps; leaving eases back flat.
 */
export function GlareCard({ children, className, maxTilt = 5 }: { children: ReactNode; className?: string; maxTilt?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const spring = { stiffness: 220, damping: 26, mass: 0.6 };
  const rotateX = useSpring(useTransform(py, [0, 1], [maxTilt, -maxTilt]), spring);
  const rotateY = useSpring(useTransform(px, [0, 1], [-maxTilt, maxTilt]), spring);

  function onMove(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse" || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    px.set(x);
    py.set(y);
    ref.current.style.setProperty("--card-x", `${(x * 100).toFixed(1)}%`);
    ref.current.style.setProperty("--card-y", `${(y * 100).toFixed(1)}%`);
    ref.current.style.setProperty("--card-glare", "1");
  }
  function onLeave() {
    px.set(0.5);
    py.set(0.5);
    ref.current?.style.setProperty("--card-glare", "0");
  }

  return (
    <motion.div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      style={reduce ? undefined : { rotateX, rotateY, transformPerspective: 1100 }}
      className={cn("glare-surface will-change-transform", className)}
    >
      {children}
    </motion.div>
  );
}
