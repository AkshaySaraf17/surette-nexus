"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, CalendarClock, ClipboardList, FileText, Handshake, Plus } from "lucide-react";
import { useStaff } from "@/components/admin/admin-shell";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/client-api";
import { STAGE_LABEL, type DealStage } from "@/lib/deal-rules";
import { formatPrice } from "@/lib/money";
import { useLiveEvents } from "@/lib/use-live";
import { cn } from "@/lib/utils";

interface Dashboard {
  listings: { active: number; pending: number; draft: number };
  leads: { new_count: number; week: number; follow_ups_due: number };
  pipeline: { stage: DealStage; deals: number; value_cents: number; commission_cents: number }[];
  due: { kind: string; title: string; due_on: string; deal_id: string; deal_title: string }[];
  recentLeads: { id: string; contact_name: string; source: string; status: string; created_at: string; property: string | null }[];
  drafts: number;
  showingsRequested: number;
  website: { page_views: number; sessions: number; visitors: number } | null;
  ai: { configured: boolean; available: boolean; model: string | null };
  today: string;
}

/** Portal home: what needs attention today, scoped to the signed-in person's access. */
interface MarketPoint { id: string; latest: { period: string; value: number; moe: number | null } | null; observations: { period: string; value: number }[] }

/** Latest value and the value a year earlier for one series (null when unavailable). */
function point(series: MarketPoint[], id: string) {
  const s = series.find((x) => x.id === id);
  if (!s?.latest) return null;
  const prior = s.observations.find((o) => o.period === `${Number(s.latest!.period.slice(0, 4)) - 1}${s.latest!.period.slice(4)}`);
  return { ...s.latest, prior: prior?.value ?? null };
}

export default function AdminDashboard() {
  const viewer = useStaff();
  const [d, setD] = useState<Dashboard | null>(null);
  const [market, setMarket] = useState<MarketPoint[]>([]);
  useEffect(() => {
    api<{ series: MarketPoint[] }>("/api/market?years=2").then((m) => setMarket(m.series)).catch(() => undefined);
  }, []);
  const load = useCallback(() => api<Dashboard>("/api/admin/dashboard").then(setD), []);
  useEffect(() => {
     
    void load();
  }, [load]);
  useLiveEvents(() => void load(), (e) => ["leads", "transactions", "transaction_milestones", "transaction_tasks", "showings", "properties"].includes(e.table));

  if (!d) return <Skeleton className="h-[600px] w-full rounded-[28px]" />;
  const open = d.pipeline.filter((p) => p.stage !== "closed");
  const pipelineValue = open.reduce((a, p) => a + Number(p.value_cents), 0);
  const commission = open.reduce((a, p) => a + Number(p.commission_cents), 0);
  const overdue = d.due.filter((x) => x.due_on < d.today).length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="type-eyebrow text-gold">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
          <h1 className="type-title mt-2">Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {viewer.fullName.split(" ")[0]}.</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/listings/new" className={buttonVariants({ size: "sm" })}><Plus /> New listing</Link>
          <Link href="/admin/deals?new=1" className={buttonVariants({ size: "sm", variant: "outline" })}><Handshake /> New deal</Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "New leads", value: d.leads.new_count, sub: `${d.leads.week} this week · ${d.leads.follow_ups_due} follow-ups due`, href: "/admin/leads", icon: ClipboardList },
          { label: "Open pipeline", value: formatPrice(pipelineValue), sub: `${open.reduce((a, p) => a + p.deals, 0)} deals · ~${formatPrice(commission)} est. commission`, href: "/admin/deals", icon: Handshake },
          { label: "Due in 7 days", value: d.due.length, sub: overdue ? `${overdue} overdue` : "nothing overdue", href: "/admin/deals", icon: CalendarClock, tone: overdue ? "text-danger" : "" },
          { label: "Drafts to approve", value: d.drafts, sub: `${d.showingsRequested} showing request${d.showingsRequested === 1 ? "" : "s"} to confirm`, href: "/admin/deals", icon: FileText },
        ].map((k) => (
          <Link key={k.label} href={k.href} className="group rounded-[22px] bg-paper p-5 ring-1 ring-line transition-shadow hover:shadow-sm">
            <div className="flex items-center justify-between text-ink-3"><span className="type-eyebrow">{k.label}</span><k.icon className="size-4" aria-hidden /></div>
            <p className={cn("tabular mt-3 text-3xl", k.tone)}>{k.value}</p>
            <p className="mt-1 text-[0.8125rem] text-ink-2">{k.sub}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="rounded-[24px] bg-paper p-6 ring-1 ring-line xl:col-span-2" aria-labelledby="due-h">
          <div className="flex items-center justify-between"><h2 id="due-h" className="type-headline">Deadlines this week</h2><Link href="/admin/deals" className="text-sm underline underline-offset-4">All deals</Link></div>
          {d.due.length === 0 ? <p className="mt-3 text-sm text-ink-2">Nothing due in the next 7 days.</p> : (
            <ul className="mt-4 divide-y divide-line">
              {d.due.map((x, i) => (
                <li key={i}>
                  <Link href={`/admin/deals/${x.deal_id}`} className="flex items-center justify-between gap-4 py-3 hover:bg-fill/40">
                    <span className="min-w-0"><span className="block truncate font-medium">{x.title}</span><span className="block truncate text-[0.8125rem] text-ink-2">{x.deal_title} · {x.kind}</span></span>
                    <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[0.75rem]", x.due_on < d.today ? "bg-danger-bg text-danger" : x.due_on === d.today ? "bg-warn-bg text-warn" : "bg-fill text-ink-2")}>
                      {x.due_on < d.today && <AlertTriangle className="mr-1 inline size-3" aria-hidden />}{x.due_on === d.today ? "Today" : x.due_on}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-[24px] bg-paper p-6 ring-1 ring-line" aria-labelledby="pipe-h">
          <h2 id="pipe-h" className="type-headline">Pipeline by stage</h2>
          <ul className="mt-4 space-y-2.5">
            {open.length === 0 ? <li className="text-sm text-ink-2">No open deals yet.</li> : open.map((p) => (
              <li key={p.stage}>
                <div className="flex justify-between text-sm"><span>{STAGE_LABEL[p.stage]}</span><span className="tabular text-ink-2">{p.deals} · {formatPrice(Number(p.value_cents))}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-fill"><div className="h-full rounded-full bg-gold" style={{ width: `${pipelineValue ? Math.max(4, (Number(p.value_cents) / pipelineValue) * 100) : 4}%` }} /></div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="rounded-[24px] bg-paper p-6 ring-1 ring-line xl:col-span-2" aria-labelledby="leads-h">
          <div className="flex items-center justify-between"><h2 id="leads-h" className="type-headline">Latest leads</h2><Link href="/admin/leads" className="text-sm underline underline-offset-4">All leads</Link></div>
          {d.recentLeads.length === 0 ? <p className="mt-3 text-sm text-ink-2">New inquiries from the website, concierge and showing requests land here.</p> : (
            <ul className="mt-4 divide-y divide-line text-sm">
              {d.recentLeads.map((l) => (
                <li key={l.id}><Link href={`/admin/leads?open=${l.id}`} className="flex justify-between gap-3 py-2.5 hover:underline"><span><span className="font-medium">{l.contact_name}</span> <span className="text-ink-2">· {l.source.replace("_", " ")}{l.property ? ` · ${l.property}` : ""}</span></span><span className="shrink-0 text-ink-3">{l.status}</span></Link></li>
              ))}
            </ul>
          )}
        </section>
        <section className="space-y-4 rounded-[24px] bg-paper p-6 ring-1 ring-line">
          <h2 className="type-headline">Listings & site</h2>
          <p className="text-sm text-ink-2">{d.listings.active} active · {d.listings.pending} under contract · {d.listings.draft} drafts</p>
          {d.website && (
            <Link href="/admin/analytics" className="block rounded-2xl bg-fill p-4 text-sm hover:bg-line/60">
              <span className="block font-medium">Website, last 30 days (production data)</span>
              <span className="text-ink-2">{d.website.sessions} sessions · {d.website.page_views} page views</span>
              <span className="mt-1 flex items-center gap-1 text-[0.8125rem]">Open analytics <ArrowRight className="size-3" /></span>
            </Link>
          )}
          {market.length > 0 && (() => {
            const unemp = point(market, "bls:unemployment_rate:kennebec");
            const permits = point(market, "bps:units_authorized:kennebec");
            const value = point(market, "acs:median_home_value:kennebec");
            const wtv = point(market, "acs:median_home_value:waterville");
            const hpi = point(market, "fhfa:hpi_annual:kennebec");
            return (
              <Link href="/market" className="block rounded-2xl bg-fill p-4 text-sm hover:bg-line/60">
                <span className="block font-medium">Local market (government data)</span>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[0.8125rem]">
                  {unemp && <><dt className="text-ink-2">Kennebec unemployment</dt><dd className="tabular text-right">{unemp.value.toFixed(1)}% <span className="text-ink-3">({unemp.period.slice(0, 7)})</span></dd></>}
                  {hpi && hpi.prior && <><dt className="text-ink-2">County prices, 1 yr</dt><dd className="tabular text-right">{(((hpi.value - hpi.prior) / hpi.prior) * 100).toFixed(1)}% <span className="text-ink-3">({hpi.period.slice(0, 4)})</span></dd></>}
                  {permits && <><dt className="text-ink-2">New homes permitted</dt><dd className="tabular text-right">{permits.value.toLocaleString("en-US")} <span className="text-ink-3">({permits.period.slice(0, 4)})</span></dd></>}
                  {value && <><dt className="text-ink-2">Median home value</dt><dd className="tabular text-right">{formatPrice(value.value * 100)}</dd></>}
                  {wtv && <><dt className="text-ink-2">— Waterville</dt><dd className="tabular text-right">{formatPrice(wtv.value * 100)}</dd></>}
                </dl>
                <span className="mt-2 block text-[0.75rem] text-ink-3">BLS · Census · FHFA. Open the market dashboard →</span>
              </Link>
            );
          })()}
          <p className="text-[0.8125rem] text-ink-3">Local AI: {d.ai.available ? `on (${d.ai.model})` : d.ai.configured ? "configured but unreachable — using built-in answers" : "not configured — using built-in answers"}.</p>
        </section>
      </div>
    </div>
  );
}
