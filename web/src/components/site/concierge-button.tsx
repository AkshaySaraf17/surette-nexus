"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { openConcierge } from "./concierge";

/** A button that opens the concierge, optionally with a first message. */
export function ConciergeButton({ prompt, children, variant = "outline" }: { prompt?: string; children: ReactNode; variant?: "outline" | "gold" | "primary" | "glass" }) {
  return (
    <Button type="button" variant={variant} size="lg" onClick={() => openConcierge(prompt)}>
      {children}
    </Button>
  );
}
