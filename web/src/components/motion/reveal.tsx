"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

const spring = { type: "spring", bounce: 0, duration: 0.9 } as const;

/** Fade-and-rise once as the element scrolls into view (critically damped — no overshoot). */
export function Reveal({ children, delay = 0, className, y = 32 }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10% 0px" }}
      transition={{ ...spring, delay }}
    >
      {children}
    </motion.div>
  );
}

/** A headline whose words rise into place one after another, with a soft blur-to-sharp focus pull. */
export function RevealWords({ text, className, as = "h2", delay = 0 }: { text: string; className?: string; as?: "h1" | "h2" | "p"; delay?: number }) {
  const reduce = useReducedMotion();
  const Tag = motion[as];
  const words = text.split(" ");
  return (
    <Tag className={className} initial="hidden" whileInView="shown" viewport={{ once: true, margin: "-10% 0px" }} aria-label={text}>
      {words.map((word, i) => (
        <span key={`${word}-${i}`} className="inline-block overflow-hidden pb-[0.08em] align-bottom" aria-hidden>
          <motion.span
            className="inline-block"
            variants={{
              hidden: reduce ? { opacity: 0 } : { y: "105%", opacity: 0, filter: "blur(8px)" },
              shown: { y: "0%", opacity: 1, filter: "blur(0px)", transition: { ...spring, delay: delay + i * 0.055 } },
            }}
          >
            {word}
            {i < words.length - 1 ? " " : ""}
          </motion.span>
        </span>
      ))}
    </Tag>
  );
}
