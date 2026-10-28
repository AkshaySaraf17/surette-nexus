"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { openAssistant } from "./assistant";

/** A button that opens the AI assistant, optionally with a first message. */
export function AssistantButton({ prompt, children, variant = "outline" }: { prompt?: string; children: ReactNode; variant?: "outline" | "brand" | "primary" | "glass" }) {
  return (
    <Button type="button" variant={variant} size="lg" onClick={() => openAssistant(prompt)}>
      {children}
    </Button>
  );
}
