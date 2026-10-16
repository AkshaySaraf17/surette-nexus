"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { api } from "@/lib/client-api";
import { track } from "@/lib/analytics-client";
import type { ListingCard } from "@/lib/types";

const BUDGETS = [
  { label: "Any budget", value: "" },
  { label: "Under $400K", value: "40000000" },
  { label: "Under $600K", value: "60000000" },
  { label: "Under $900K", value: "90000000" },
  { label: "Under $1.5M", value: "150000000" },
  { label: "Under $2M", value: "200000000" },
];

/** The first thing a visitor can do: a three-field search with a live count of available homes. */
export function HeroSearch() {
  const router = useRouter();
  const [towns, setTowns] = useState<string[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [city, setCity] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [minBeds, setMinBeds] = useState("");

  useEffect(() => {
    api<{ listings: ListingCard[] }>("/api/properties?limit=200")
      .then(({ listings }) => {
        setCount(listings.filter((l) => l.status === "active").length);
        setTowns([...new Set(listings.map((l) => l.city))].sort());
      })
      .catch(() => setCount(null));
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = new URLSearchParams();
    if (city) q.set("city", city);
    if (maxPrice) q.set("maxPrice", maxPrice);
    if (minBeds) q.set("minBeds", minBeds);
    track("search_submit", { surface: "hero", has_city: Boolean(city), price_band: maxPrice || "any", min_beds: minBeds || "any" });
    router.push(`/listings${q.size ? `?${q}` : ""}`);
  }

  const select = "h-12 w-full appearance-none rounded-full bg-white px-4 text-[0.9375rem] text-[#15130f] outline-none focus:ring-4 focus:ring-[#d9b98a]/50";
  return (
    <form role="search" aria-label="Find a home" onSubmit={submit} className="mx-auto mt-10 w-full max-w-3xl">
      <div className="material grid gap-2 rounded-[28px] border border-white/20 p-2 sm:grid-cols-[1.2fr_1fr_0.8fr_auto] sm:rounded-full">
        <label className="sr-only" htmlFor="hs-town">Town</label>
        <select id="hs-town" value={city} onChange={(e) => setCity(e.target.value)} className={select}>
          <option value="">Anywhere in Central Maine</option>
          {towns.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="sr-only" htmlFor="hs-budget">Budget</label>
        <select id="hs-budget" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} className={select}>
          {BUDGETS.map((b) => <option key={b.label} value={b.value}>{b.label}</option>)}
        </select>
        <label className="sr-only" htmlFor="hs-beds">Bedrooms</label>
        <select id="hs-beds" value={minBeds} onChange={(e) => setMinBeds(e.target.value)} className={select}>
          <option value="">Any beds</option>
          {[2, 3, 4, 5].map((b) => <option key={b} value={b}>{b}+ beds</option>)}
        </select>
        <button type="submit" className="pressable flex h-12 items-center justify-center gap-2 rounded-full bg-gold px-6 font-medium text-white hover:brightness-110">
          <Search className="size-4" aria-hidden /> Search
        </button>
      </div>
      <p className="mt-4 text-sm text-white/75" aria-live="polite">
        {count === null ? " " : <><span className="mr-2 inline-block size-2 rounded-full bg-[#6fd394] align-middle" aria-hidden />{count} homes available now · updated live</>}
      </p>
    </form>
  );
}
