import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn/ui class combiner: conditional classes, later Tailwind utilities win. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Real-estate convention: 2 full + any half baths → "2.5" (the exact split is shown in the facts table). */
export function formatBaths(full: number, half: number): string {
  return half > 0 ? `${full}.5` : String(full);
}

export function formatSqft(sqft: number | null): string | null {
  return sqft ? `${sqft.toLocaleString("en-US")} sq ft` : null;
}

export function formatAcres(sqft: number | null): string | null {
  if (!sqft) return null;
  const hundredths = Math.round((sqft * 100) / 43_560);
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")} acres`;
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Available",
  pending: "Under contract",
  sold: "Sold",
  off_market: "Off market",
};
