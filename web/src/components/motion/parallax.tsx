import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A still, rounded image frame. (It used to drift against the scroll; the site no longer moves while scrolling.) */
export function Parallax({ children, className }: { children: ReactNode; strength?: number; className?: string }) {
  return <div className={cn("overflow-hidden", className)}>{children}</div>;
}
