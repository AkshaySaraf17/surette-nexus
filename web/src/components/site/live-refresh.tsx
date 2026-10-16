"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { useLiveEvents } from "@/lib/use-live";

/** Re-render the current server page (no reload, state kept) when this listing or its photos change. */
export function LiveRefresh({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLiveEvents(
    () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 250);
    },
    (e) => e.propertyId === propertyId && (e.table === "properties" || e.table === "media_assets"),
  );
  return null;
}
