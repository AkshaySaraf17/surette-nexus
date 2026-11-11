import type { Metadata } from "next";
import { OffMarketForm } from "@/components/site/off-market-form";
import { BRAND, BROKERAGE } from "@/lib/site";

export const metadata: Metadata = { title: "Off-market home alerts", robots: { index: false, follow: false } };

/**
 * The off-market sign-up on its own, with no site header or footer, so the team can place it on
 * another website (for example their Lofty site) with an <iframe>. Sign-ups arrive as
 * "Off-market alert" leads in the portal. See docs/off-market-embed.md.
 */
export default function OffMarketEmbedPage() {
  return (
    <main id="main" className="mx-auto max-w-3xl bg-paper p-4 sm:p-6">
      <h1 className="type-headline">Get first look at off-market homes</h1>
      <p className="mt-2 text-sm text-ink-2">Tell us what you&rsquo;re looking for. We&rsquo;ll reach out when a home that fits comes up, often before it&rsquo;s listed.</p>
      <div className="mt-5">
        <OffMarketForm embedded />
      </div>
      <p className="mt-4 text-center text-[0.6875rem] text-ink-3">{BRAND} Team at {BROKERAGE}</p>
    </main>
  );
}
