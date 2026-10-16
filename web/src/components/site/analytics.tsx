"use client";

import Link from "next/link";
import Script from "next/script";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { track } from "@/lib/analytics-client";

const PROJECT = process.env.NEXT_PUBLIC_ANALYTICS_PROJECT ?? "nexus-site";
const MODE = process.env.NEXT_PUBLIC_ANALYTICS_CONSENT_MODE === "opt-out" ? "opt-out" : "opt-in";

/** Loads the first-party SDK asynchronously (never blocks rendering) and shows the consent choice. */
export function Analytics() {
  const [choice, setChoice] = useState<"granted" | "denied" | "unset" | "loading">("loading");

  useEffect(() => {
    const read = () => {
      try {
        const v = localStorage.getItem("sa_consent");
        setChoice(v === "granted" || v === "denied" ? v : "unset");
      } catch {
        setChoice("unset");
      }
    };
    read();
    window.addEventListener("surette-analytics:consent", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("surette-analytics:consent", read);
      window.removeEventListener("storage", read);
    };
  }, []);

  function decide(state: "granted" | "denied") {
    try {
      if (window.SuretteAnalytics) window.SuretteAnalytics.consent(state);
      else localStorage.setItem("sa_consent", state);
    } catch {
      // ignore
    }
    setChoice(state);
  }

  return (
    <>
      <Script src="/sdk/surette-analytics.js" strategy="afterInteractive" data-project={PROJECT} data-endpoint="/api/analytics/collect" data-consent-mode={MODE} />
      <AnimatePresence>
        {choice === "unset" && (
          <motion.div
            role="region"
            aria-label="Analytics choice"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ type: "spring", bounce: 0, duration: 0.45, delay: 1.2 }}
            className="fixed bottom-5 left-5 z-40 w-[min(380px,calc(100vw-7.5rem))] rounded-3xl bg-paper p-5 text-ink shadow-lg ring-1 ring-line"
          >
            <p className="text-sm font-medium">Help us improve the site?</p>
            <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-2">
              With your OK we measure anonymous page visits and clicks on our own servers — no ad trackers, no cookies, never what you type.{" "}
              <Link href="/privacy" className="underline underline-offset-2">Details</Link>
            </p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => decide("granted")} className="pressable rounded-full bg-ink px-4 py-2 text-[0.8125rem] font-medium text-paper">Allow</button>
              <button type="button" onClick={() => decide("denied")} className="pressable rounded-full border border-line-strong px-4 py-2 text-[0.8125rem]">No thanks</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** Fires a one-off event when mounted (e.g. property_view on a listing page). */
export function TrackOnMount({ type, props }: { type: string; props?: Record<string, string | number | boolean> }) {
  useEffect(() => {
    track(type, props);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per mount
  }, []);
  return null;
}
