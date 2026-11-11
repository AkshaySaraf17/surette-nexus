import type { Metadata } from "next";
import { BellRing, Handshake, KeyRound } from "lucide-react";
import { OffMarketForm } from "@/components/site/off-market-form";

export const metadata: Metadata = {
  title: "Off-market homes",
  description: "Tell the Surette team what you're looking for. We hear about homes in Waterville and Central Maine before they're listed, and we'll reach out when one fits.",
};

const STEPS = [
  { icon: KeyRound, title: "Tell us what you want", text: "A camp on the Belgrade Lakes, a farmhouse with land, a starter home near Augusta: pick what matters and where." },
  { icon: Handshake, title: "We keep watch", text: "Owners often talk to us before they list, through past clients, neighbors and other agents. We match those homes against your wish list." },
  { icon: BellRing, title: "You hear first", text: "When something fits, a team member calls or emails you, often before the home reaches the MLS or the big listing sites." },
];

/** Off-market alerts: the team's lead magnet for buyers who want first look at homes not yet listed. */
export default function OffMarketPage() {
  return (
    <div className="mx-auto max-w-[1400px] px-5 pb-32 pt-32 sm:px-8">
      <div className="grid gap-14 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <p className="type-eyebrow text-brand">Off-market homes</p>
          <h1 className="type-display mt-3">See homes before they&rsquo;re listed.</h1>
          <p className="type-lede mt-6 text-ink-2">
            Some of the best homes in Central Maine sell quietly, through people who know people. Tell us what you&rsquo;re looking for and we&rsquo;ll let you know when one comes up.
          </p>
          <ol className="mt-10 space-y-6">
            {STEPS.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="flex gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-on-brand" aria-hidden>
                  <Icon className="size-5" />
                </span>
                <div>
                  <h2 className="font-medium">{i + 1}. {title}</h2>
                  <p className="mt-1 text-ink-2">{text}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-10 text-sm text-ink-3">
            Off-market homes are never guaranteed: they depend on what owners decide. Your details stay with the Surette team and are never sold or shared.
          </p>
        </div>
        <div className="lg:col-span-7">
          <OffMarketForm />
        </div>
      </div>
    </div>
  );
}
