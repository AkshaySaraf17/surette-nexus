"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "./client-api";
import type { Viewer } from "./types";

/** The signed-in user (or null), fetched once per mount; `refresh` after sign-in/out. */
export function useViewer() {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const { user } = await api<{ user: Viewer | null }>("/api/auth/session");
      setViewer(user);
    } catch (error) {
      if (!(error instanceof ApiClientError)) console.warn(error);
      setViewer(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void refresh();
  }, [refresh]);
  return { viewer, loading, refresh };
}
