"use client";

/**
 * Typed wrapper around the first-party SDK (window.SuretteAnalytics). Calls made before
 * the SDK loads are queued; if analytics is blocked or declined, calls are no-ops and
 * the site keeps working.
 */
type Props = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    SuretteAnalytics?: {
      track: (type: string, props?: Props) => void;
      consent: (state: "granted" | "denied") => void;
      getConsent: () => "granted" | "denied" | "unset";
      flush: () => void;
    };
    SuretteAnalyticsQueue?: unknown[][];
  }
}

export function track(type: string, props: Props = {}) {
  if (typeof window === "undefined") return;
  const clean = Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined)) as Props;
  try {
    if (window.SuretteAnalytics) window.SuretteAnalytics.track(type, clean);
    else (window.SuretteAnalyticsQueue ??= []).push(["track", type, clean]);
  } catch {
    // Analytics must never break the page.
  }
}

/** Maps a max-price in cents to a coarse, non-identifying band label. */
export function priceBand(cents: string | number | null | undefined): string {
  const n = Number(cents);
  if (!n) return "any";
  if (n <= 40_000_000) return "under_400k";
  if (n <= 60_000_000) return "400k_600k";
  if (n <= 90_000_000) return "600k_900k";
  if (n <= 150_000_000) return "900k_1_5m";
  return "over_1_5m";
}
