"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { priceBand, track } from "@/lib/analytics-client";

const PRICE_STEPS = [
  { label: "Any price", value: "" },
  { label: "Under $500K", value: "50000000" },
  { label: "Under $750K", value: "75000000" },
  { label: "Under $1M", value: "100000000" },
  { label: "Under $1.5M", value: "150000000" },
  { label: "Under $2M", value: "200000000" },
];

/** Filter bar for /listings. Writes to the URL (shareable, back-button friendly); the server re-renders the grid. */
export function ListingFilters({ cities }: { cities: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === "q") track("search_submit", { surface: "listings", fields_used: next.size });
    else if (key === "sort") track("sort_change", { sort: value || "featured" });
    else track("filter_change", { filter: key === "maxPrice" ? "max_price" : key === "minBeds" ? "min_beds" : key, value: key === "maxPrice" ? priceBand(value) : key === "city" ? (value ? "town" : "any") : value || "any" });
    startTransition(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  }

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q) update("q", q.trim());
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce on q only
  }, [q]);

  return (
    <div className={cn("material sticky top-16 z-30 -mx-5 border-y border-line px-5 py-3 transition-opacity sm:-mx-8 sm:px-8", pending && "opacity-70")}>
      <form role="search" className="flex flex-wrap items-center gap-2.5" onSubmit={(e) => e.preventDefault()}>
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <label htmlFor="f-q" className="sr-only">Search homes</label>
          <Input id="f-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Lakefront, farmhouse, Main Street…" className="pl-10" />
        </div>
        <label htmlFor="f-city" className="sr-only">Town</label>
        <Select id="f-city" value={params.get("city") ?? ""} onChange={(e) => update("city", e.target.value)} className="w-auto">
          <option value="">All towns</option>
          {cities.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
        <label htmlFor="f-type" className="sr-only">Buy or rent</label>
        <Select id="f-type" value={params.get("type") ?? ""} onChange={(e) => update("type", e.target.value)} className="w-auto">
          <option value="">Buy or rent</option>
          <option value="sale">For sale</option>
          <option value="rent">For lease</option>
        </Select>
        <label htmlFor="f-price" className="sr-only">Maximum price</label>
        <Select id="f-price" value={params.get("maxPrice") ?? ""} onChange={(e) => update("maxPrice", e.target.value)} className="w-auto">
          {PRICE_STEPS.map((p) => (
            <option key={p.label} value={p.value}>{p.label}</option>
          ))}
        </Select>
        <label htmlFor="f-beds" className="sr-only">Bedrooms</label>
        <Select id="f-beds" value={params.get("minBeds") ?? ""} onChange={(e) => update("minBeds", e.target.value)} className="w-auto">
          <option value="">Any beds</option>
          {[2, 3, 4, 5].map((b) => (
            <option key={b} value={b}>{b}+ beds</option>
          ))}
        </Select>
        <label htmlFor="f-sort" className="sr-only">Sort</label>
        <Select id="f-sort" value={params.get("sort") ?? ""} onChange={(e) => update("sort", e.target.value)} className="w-auto">
          <option value="">Featured</option>
          <option value="newest">Newest</option>
          <option value="price_desc">Price: high to low</option>
          <option value="price_asc">Price: low to high</option>
        </Select>
        <label className="flex items-center gap-2 px-2 text-[0.8125rem] text-ink-2">
          <input type="checkbox" checked={params.get("sold") === "1"} onChange={(e) => update("sold", e.target.checked ? "1" : "")} className="accent-[var(--gold)]" />
          Include sold
        </label>
      </form>
    </div>
  );
}
