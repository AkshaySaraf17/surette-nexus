import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Mail, Phone } from "lucide-react";
import { Reveal, RevealWords } from "@/components/motion/reveal";
import { GlareCard } from "@/components/motion/glare-card";
import { AgentPortrait } from "@/components/site/agent-portrait";
import { AssistantButton } from "@/components/site/assistant-button";
import { Skeleton } from "@/components/ui/skeleton";
import { TrackOnMount } from "@/components/site/analytics";
import { getSiteTeam, listTeamMembers } from "@/lib/server/listings";

export const metadata: Metadata = { title: "Our team", description: "Meet the Surette Real Estate team, led by Jeffrey Jolicoeur." };

async function Directory() {
  await connection();
  const [team, members] = await Promise.all([getSiteTeam(), listTeamMembers()]);
  const [leader, ...rest] = members;
  return (
    <>
      {leader && <TrackOnMount type="agent_profile_view" props={{ agent_id: leader.id }} />}
      {leader && (
        <section className="grid items-center gap-12 lg:grid-cols-12" aria-labelledby="leader-name">
          <Reveal className="lg:col-span-5">
            <GlareCard className="rounded-[32px]">
              <AgentPortrait agent={leader} className="aspect-[4/5] w-full rounded-[32px] shadow-lg" />
            </GlareCard>
          </Reveal>
          <Reveal className="lg:col-span-6 lg:col-start-7" delay={0.1}>
            <p className="type-eyebrow text-brand">{leader.title}</p>
            <h2 id="leader-name" className="type-display mt-4">{leader.fullName}</h2>
            {leader.bio && <p className="type-lede mt-6 text-ink-2">{leader.bio}</p>}
            <ul className="mt-8 space-y-2 text-sm">
              {leader.phone && <li><a href={`tel:${leader.phone}`} className="inline-flex items-center gap-2 hover:underline"><Phone className="size-4" aria-hidden />{leader.phone}</a></li>}
              <li><a href={`mailto:${leader.email}`} className="inline-flex items-center gap-2 hover:underline"><Mail className="size-4" aria-hidden />{leader.email}</a></li>
            </ul>
            <div className="mt-8">
              <AssistantButton variant="primary" prompt={`I'd like to talk with ${leader.fullName}.`}>Request a conversation</AssistantButton>
            </div>
          </Reveal>
        </section>
      )}

      <section className="mt-32" aria-labelledby="exec-team">
        <h2 id="exec-team" className="type-title">The executive team</h2>
        {rest.length === 0 ? (
          <p className="mt-6 max-w-xl text-ink-2">
            Team profiles are published from the team portal. {team.name} has served {team.market} since {team.foundedYear ?? "1978"}.
          </p>
        ) : (
          <ul className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((m, i) => (
              <li key={m.id}>
                <Reveal delay={(i % 3) * 0.06}>
                  <GlareCard className="rounded-[28px]">
                    <article className="overflow-hidden rounded-[28px] bg-paper ring-1 ring-line">
                      <AgentPortrait agent={m} className="aspect-[4/5] w-full" />
                      <div className="p-6">
                        <h3 className="type-headline">{m.fullName}</h3>
                        <p className="mt-1 text-sm text-brand">{m.title}</p>
                        {m.bio && <p className="mt-3 line-clamp-4 text-sm text-ink-2">{m.bio}</p>}
                        <p className="mt-4 text-sm"><a href={`mailto:${m.email}`} className="underline underline-offset-4">{m.email}</a></p>
                      </div>
                    </article>
                  </GlareCard>
                </Reveal>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function TeamPage() {
  return (
    <div data-tone="ivory" className="mx-auto max-w-[1400px] px-5 pb-36 pt-32 sm:px-8">
      <p className="type-eyebrow text-brand">Our team</p>
      <RevealWords as="h1" className="type-display mt-4 max-w-4xl" text="Local knowledge, carried across generations." />
      <div className="mt-24">
        <Suspense fallback={<Skeleton className="h-[520px] w-full rounded-[32px]" />}>
          <Directory />
        </Suspense>
      </div>
    </div>
  );
}
