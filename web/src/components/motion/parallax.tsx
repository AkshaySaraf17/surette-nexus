"use client";

import { motion, useReducedMotion, useTransform } from "motion/react";
import { useScrollProgress } from "./use-scroll-progress";
import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Content that drifts against the scroll (depth). `strength` is the travel in % of its height. */
export function Parallax({ children, strength = 12, className }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const scrollYProgress = useScrollProgress(ref, ["start end", "end start"]);
  const y = useTransform(scrollYProgress, [0, 1], [`-${strength}%`, `${strength}%`]);
  return (
    <div ref={ref} className={cn("overflow-hidden", className)}>
      <motion.div style={reduce ? undefined : { y, scale: 1 + strength / 50 }} className="size-full">
        {children}
      </motion.div>
    </div>
  );
}
