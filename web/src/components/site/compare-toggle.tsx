"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Columns3 } from "lucide-react";

const KEY = "sn_compare";
const read = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
};

/** Adds a home to a small compare tray kept in this browser (up to 4). */
export function CompareToggle({ propertyId }: { propertyId: string }) {
  const [ids, setIds] = useState<string[]>([]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read the tray once
  useEffect(() => setIds(read()), []);
  const on = ids.includes(propertyId);
  function toggle() {
    const next = on ? ids.filter((x) => x !== propertyId) : [...ids, propertyId].slice(-4);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    setIds(next);
  }
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={toggle} aria-pressed={on} className="pressable inline-flex items-center gap-2 rounded-full border border-line-strong px-4 py-2 text-sm">
        <Columns3 className="size-4" aria-hidden /> {on ? "Added to compare" : "Compare"}
      </button>
      {ids.length >= 2 && (
        <Link href={`/compare?ids=${ids.join(",")}`} className="text-sm font-medium underline underline-offset-4">Compare {ids.length} homes →</Link>
      )}
    </div>
  );
}
