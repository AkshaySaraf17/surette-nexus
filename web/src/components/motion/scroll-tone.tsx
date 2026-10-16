"use client";

import { useEffect } from "react";

/**
 * Scroll-reactive palette. Any section can declare `data-tone="ivory|dusk|pine|navy|gold|night"`.
 * Whichever toned section crosses the middle of the viewport sets the page background,
 * ink color and cursor-glare tint; body transitions between them (globals.css), so colors
 * melt into one another as you scroll — like Apple's product pages.
 */
type Tone = { bg: string; ink: string; glare: string };

const LIGHT: Record<string, Tone> = {
  ivory: { bg: "#f7f4ee", ink: "#15130f", glare: "rgb(217 185 138 / 0.38)" },
  paper: { bg: "#fffdf9", ink: "#15130f", glare: "rgb(166 124 61 / 0.25)" },
  dusk: { bg: "#efe4d6", ink: "#2a1f14", glare: "rgb(255 170 110 / 0.42)" },
  pine: { bg: "#1f3a32", ink: "#eef0ea", glare: "rgb(150 220 180 / 0.28)" },
  navy: { bg: "#0f1a24", ink: "#eef1f5", glare: "rgb(120 170 255 / 0.3)" },
  gold: { bg: "#e9dcc4", ink: "#231a0e", glare: "rgb(255 210 140 / 0.5)" },
  night: { bg: "#0b0a08", ink: "#f3efe7", glare: "rgb(210 169 101 / 0.3)" },
};
const DARK: Record<string, Tone> = {
  ...LIGHT,
  ivory: { bg: "#0d0c0a", ink: "#f3efe7", glare: "rgb(210 169 101 / 0.22)" },
  paper: { bg: "#16140f", ink: "#f3efe7", glare: "rgb(210 169 101 / 0.2)" },
  dusk: { bg: "#1c140d", ink: "#f3e6d6", glare: "rgb(255 150 90 / 0.25)" },
  gold: { bg: "#21190d", ink: "#f3e6d0", glare: "rgb(255 200 120 / 0.28)" },
};

export function ScrollTone() {
  useEffect(() => {
    const root = document.documentElement;
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    let current = "";

    const apply = (name: string) => {
      const tone = (dark.matches ? DARK : LIGHT)[name] ?? (dark.matches ? DARK : LIGHT).ivory;
      root.style.setProperty("--tone-bg", tone.bg);
      root.style.setProperty("--tone-ink", tone.ink);
      root.style.setProperty("--glare-a", tone.glare);
      root.dataset.tone = name;
      current = name;
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const name = (entry.target as HTMLElement).dataset.tone ?? "ivory";
            if (name !== current) apply(name);
          }
        }
      },
      { rootMargin: "-50% 0px -50% 0px", threshold: 0 },
    );

    const observeAll = () => {
      observer.disconnect();
      document.querySelectorAll<HTMLElement>("[data-tone]").forEach((el) => observer.observe(el));
    };
    observeAll();
    const mutations = new MutationObserver(observeAll);
    mutations.observe(document.body, { childList: true, subtree: true });
    const onScheme = () => apply(current || "ivory");
    dark.addEventListener("change", onScheme);
    apply(document.querySelector<HTMLElement>("[data-tone]")?.dataset.tone ?? "ivory");

    return () => {
      observer.disconnect();
      mutations.disconnect();
      dark.removeEventListener("change", onScheme);
      for (const p of ["--tone-bg", "--tone-ink", "--glare-a"]) root.style.removeProperty(p);
    };
  }, []);
  return null;
}
