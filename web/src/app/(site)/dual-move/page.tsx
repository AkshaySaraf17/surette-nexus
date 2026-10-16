import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { DualMoveCopilot } from "@/components/site/dual-move-copilot";
import { Skeleton } from "@/components/ui/skeleton";
import { withSystemDb } from "@/lib/server/db";

export const metadata: Metadata = { title: "Dual-Move Copilot — sell and buy", description: "Plan selling your home and buying the next one: proceeds, cash needed, monthly payments and three scenarios from your own numbers." };

async function Copilot() {
  await connection();
  const latest = await withSystemDb((db) =>
    db.one<{ value: number; period: string; retrieved_at: Date }>("SELECT value, period, retrieved_at FROM market_observations WHERE series_id = 'fred:MORTGAGE30US' ORDER BY period DESC LIMIT 1"),
  );
  return <DualMoveCopilot referenceRate={latest ? { value: Number(latest.value), period: latest.period, retrievedAt: latest.retrieved_at.toISOString() } : null} />;
}

export default function DualMovePage() {
  return (
    <div data-tone="paper" className="mx-auto max-w-[1400px] px-5 pb-32 pt-32 sm:px-8">
      <p className="type-eyebrow text-gold">Dual-Move Copilot</p>
      <h1 className="type-display mt-3 max-w-4xl">Selling one home and buying the next — see both moves at once.</h1>
      <p className="type-lede mt-5 max-w-2xl text-ink-2">Estimated proceeds, cash needed, monthly payments, and what changes if you sell first or buy first. Calculated from your numbers, instantly.</p>
      <div className="mt-14">
        <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-[28px]" />}>
          <Copilot />
        </Suspense>
      </div>
    </div>
  );
}
