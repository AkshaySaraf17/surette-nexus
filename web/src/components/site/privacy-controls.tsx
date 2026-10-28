"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** Analytics consent control (stored in this browser; the SDK honours it immediately). */
export function PrivacyControls() {
  const [state, setState] = useState<"granted" | "denied" | "unset">("unset");
  useEffect(() => {
    try {
      const v = localStorage.getItem("sa_consent");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read the stored choice once
      setState(v === "granted" || v === "denied" ? v : "unset");
    } catch {
      // ignore
    }
  }, []);
  function decide(next: "granted" | "denied") {
    try {
      if (window.SuretteAnalytics) window.SuretteAnalytics.consent(next);
      else localStorage.setItem("sa_consent", next);
    } catch {
      // ignore
    }
    setState(next);
  }
  return (
    <div className="mt-8 rounded-[24px] bg-paper p-6 ring-1 ring-line">
      <p className="font-medium">Anonymous analytics on this browser: <span className="text-brand">{state === "granted" ? "allowed" : state === "denied" ? "declined" : "not decided (off)"}</span></p>
      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={() => decide("granted")} disabled={state === "granted"}>Allow</Button>
        <Button size="sm" variant="outline" onClick={() => decide("denied")} disabled={state === "denied"}>Decline &amp; delete id</Button>
      </div>
    </div>
  );
}
