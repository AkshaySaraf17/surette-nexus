"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { api, ApiClientError } from "@/lib/client-api";
import { useLiveEvents } from "@/lib/use-live";
import { useViewer } from "@/lib/use-viewer";
import type { Viewer } from "@/lib/types";

interface SavedState {
  saved: Set<string>;
  signedIn: boolean;
  viewer: Viewer | null;
  toggle: (propertyId: string) => Promise<void>;
  refreshViewer: () => Promise<void>;
}

const SavedContext = createContext<SavedState>({
  saved: new Set(),
  signedIn: false,
  viewer: null,
  toggle: async () => undefined,
  refreshViewer: async () => undefined,
});

/** Site-wide session + saved-homes state. Saved hearts stay in sync across tabs and with the agent via live events. */
export function SavedProvider({ children }: { children: ReactNode }) {
  const { viewer, refresh } = useViewer();
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!viewer) {
      setSaved(new Set());
      return;
    }
    try {
      const { propertyIds } = await api<{ propertyIds: string[] }>("/api/collections/save");
      setSaved(new Set(propertyIds));
    } catch {
      // Hearts simply show unsaved if this fails.
    }
  }, [viewer]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);

  useLiveEvents(
    () => void load(),
    (e) => Boolean(viewer) && (e.table === "collection_items" || e.table === "collections"),
  );

  const toggle = useCallback(
    async (propertyId: string) => {
      const next = !saved.has(propertyId);
      setSaved((prev) => {
        const copy = new Set(prev);
        if (next) copy.add(propertyId);
        else copy.delete(propertyId);
        return copy;
      });
      try {
        const { propertyIds } = await api<{ propertyIds: string[] }>("/api/collections/save", { method: "POST", body: { propertyId, saved: next } });
        setSaved(new Set(propertyIds));
      } catch (error) {
        if (error instanceof ApiClientError && error.code === "EMAIL_NOT_VERIFIED") {
          setNotice(error.message);
          window.setTimeout(() => setNotice(""), 8000);
        }
        void load();
      }
    },
    [saved, load],
  );

  const value = useMemo(() => ({ saved, signedIn: Boolean(viewer), viewer, toggle, refreshViewer: refresh }), [saved, viewer, toggle, refresh]);
  return (
    <SavedContext.Provider value={value}>
      {children}
      {notice && (
        <div role="status" className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-md rounded-2xl bg-ink px-4 py-3 text-sm text-paper shadow-lg">
          {notice} <Link href="/account" className="underline underline-offset-4">Go to your account</Link>
        </div>
      )}
    </SavedContext.Provider>
  );
}

export const useSaved = () => useContext(SavedContext);
