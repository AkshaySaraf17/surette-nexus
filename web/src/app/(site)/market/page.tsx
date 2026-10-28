import type { Metadata } from "next";
import { MarketDashboard } from "@/components/site/market-dashboard";

export const metadata: Metadata = { title: "Central Maine market intelligence", description: "Kennebec County, Maine and U.S. housing trends from official sources — Census home values, rents and incomes by town, BLS unemployment, building permits, FHFA price indexes, listing prices and mortgage rates." };

export default function MarketPage() {
  return (
    <div data-tone="paper" className="mx-auto max-w-[1400px] px-5 pb-32 pt-32 sm:px-8">
      <p className="type-eyebrow text-brand">Market intelligence</p>
      <h1 className="type-display mt-3 max-w-4xl">How Kennebec County compares with Maine and the nation.</h1>
      <p className="type-lede mt-5 max-w-3xl text-ink-2">Official data downloaded directly from the U.S. Census Bureau, the Bureau of Labor Statistics and the Federal Housing Finance Agency, plus Freddie Mac and Realtor.com series via the Federal Reserve Bank of St. Louis — every source and date shown.</p>
      <div className="mt-12">
        <MarketDashboard />
      </div>
    </div>
  );
}
