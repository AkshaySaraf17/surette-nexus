"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client-api";
import { track } from "@/lib/analytics-client";
import { useSaved } from "./saved-context";

export function CompareActions({ ids }: { ids: string[] }) {
  const { viewer } = useSaved();
  const [state, setState] = useState("");
  useEffect(() => track("property_compare", { count: ids.length }), [ids.length]);
  if (viewer?.role !== "client") return <p className="mt-4 text-sm text-ink-3">Sign in to save this comparison to your account.</p>;
  return (
    <div className="mt-4 flex items-center gap-3">
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          await api("/api/account/comparisons", { method: "POST", body: { name: `Comparison ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, propertyIds: ids } });
          setState("Saved to your account.");
        }}
      >
        Save comparison
      </Button>
      <span className="text-sm text-ink-2" role="status">{state}</span>
    </div>
  );
}
