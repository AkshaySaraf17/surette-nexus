"use client";

import { useCallback, useEffect, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Info, Lightbulb } from "lucide-react";
import { useStaff } from "@/components/admin/admin-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiClientError } from "@/lib/client-api";
import { cn } from "@/lib/utils";

type Classes = "production" | "synthetic" | "test";
interface Overview {
  range: { from: string; to: string; classes: Classes[] };
  overview: {
    totals: { page_views: number; sessions: number; visitors: number; consented_visitors: number; engaged_seconds: number; events: number; returning_visitors: number };
    daily: { day: string; page_views: number; sessions: number; conversions: number }[];
    pages: { path: string; views: number; sessions: number }[];
    landing: { path: string; sessions: number }[];
    exits: { path: string; sessions: number }[];
    sources: { source: string; sessions: number; conversions: number }[];
    campaigns: { campaign: string; source: string | null; medium: string | null; sessions: number; property_views: number; conversions: number }[];
    devices: { device: string; sessions: number }[];
    scroll: { depth: number; sessions: number }[];
  };
  funnel: { key: string; label: string; sessions: number; denominator: number; rate: number; dropOff: number; events: string[] }[];
  journeys: { journey: string; sessions: number; converted: number }[];
  properties: {
    top: { property_id: string; title: string | null; city: string | null; views: number; card_clicks: number; saves: number; showing_requests: number }[];
    filters: { filter: string; uses: number }[];
    priceBands: { band: string; searches: number }[];
    contacted: { property_id: string; title: string | null; sessions_viewed: number; sessions_contacted: number }[];
  };
  conversions: { type: string; label: string; count: number }[];
  insights: { period: string; items: { level: string; title: string; detail: string; metrics: Record<string, number | string> }[] };
}
interface AgentData {
  listingCount: number;
  agentProfileViews: number;
  engagement: Overview["properties"] & { daily: { day: string; views: number }[] };
  leads: { status: string; n: number }[];
}

const card = "rounded-[22px] bg-paper p-5 ring-1 ring-line";
const tooltip = { contentStyle: { background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 12, fontSize: 12 } };

function Table({ title, rows, cols }: { title: string; rows: Record<string, unknown>[]; cols: [string, string][] }) {
  return (
    <section className={card}>
      <h2 className="text-sm font-medium">{title}</h2>
      {rows.length === 0 ? <p className="mt-3 text-sm text-ink-3">No data in this range.</p> : (
        <table className="mt-3 w-full text-[0.8125rem]">
          <thead className="text-left text-ink-3"><tr>{cols.map(([k, l], i) => <th key={k} className={cn("pb-2 font-medium", i > 0 && "text-right")}>{l}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{rows.map((r, i) => <tr key={i}>{cols.map(([k], j) => <td key={k} className={cn("py-1.5", j > 0 && "tabular text-right")}>{String(r[k] ?? "—")}</td>)}</tr>)}</tbody>
        </table>
      )}
    </section>
  );
}

export default function AnalyticsPage() {
  const viewer = useStaff();
  const [days, setDays] = useState(30);
  const [classes, setClasses] = useState<Classes[]>(["production"]);
  const [data, setData] = useState<Overview | null>(null);
  const [agent, setAgent] = useState<AgentData | null>(null);
  const [error, setError] = useState("");
  const isOwner = viewer.role === "admin";

  const load = useCallback(async () => {
    setError("");
    const qs = `days=${days}&classes=${classes.join(",")}`;
    try {
      if (isOwner) setData(await api<Overview>(`/api/analytics/overview?${qs}`));
      setAgent(await api<AgentData>(`/api/analytics/agent?${qs}`));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load analytics.");
    }
  }, [days, classes, isOwner]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
  }, [load]);

  const toggleClass = (c: Classes) => setClasses((cur) => (cur.includes(c) ? (cur.length > 1 ? cur.filter((x) => x !== c) : cur) : [...cur, c]));
  const t = data?.overview.totals;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="type-title">Website analytics</h1>
          <p className="mt-1 text-ink-2">{isOwner ? "First-party data from the tracking SDK on this site (and surette-realestate.com once installed)." : "Engagement on your own listings and your leads."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full bg-fill p-1" role="group" aria-label="Date range">
            {[7, 30, 90, 365].map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={cn("rounded-full px-3 py-1 text-[0.8125rem]", days === d && "bg-paper shadow-sm")}>{d === 365 ? "1y" : `${d}d`}</button>)}
          </div>
          <div className="flex items-center gap-1 rounded-full bg-fill p-1" role="group" aria-label="Data class">
            {(["production", "synthetic", "test"] as Classes[]).map((c) => (
              <button key={c} type="button" aria-pressed={classes.includes(c)} onClick={() => toggleClass(c)} className={cn("rounded-full px-3 py-1 text-[0.8125rem] capitalize", classes.includes(c) && (c === "production" ? "bg-paper shadow-sm" : "bg-warn-bg text-warn"))}>{c}</button>
            ))}
          </div>
        </div>
      </div>
      {classes.some((c) => c !== "production") && (
        <p className="flex items-start gap-2 rounded-2xl bg-warn-bg p-4 text-sm text-warn"><Info className="mt-0.5 size-4 shrink-0" />Including {classes.filter((c) => c !== "production").join(" and ")} data. Synthetic events come from the demo generator; test events from automated tests. Neither reflects real visitors.</p>
      )}
      {error && <p className="text-danger">{error}</p>}

      {isOwner && (!data ? <Skeleton className="h-96 w-full rounded-[28px]" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {[
              ["Page views", t!.page_views],
              ["Sessions", t!.sessions],
              ["Visitors*", t!.visitors],
              ["Returning*", t!.returning_visitors],
              ["Avg. engaged time", t!.sessions ? `${Math.round(t!.engaged_seconds / t!.sessions)}s` : "—"],
              ["Conversions", data.conversions.filter((c) => ["contact_submit", "showing_request_submit"].includes(c.type)).reduce((a, c) => a + c.count, 0)],
            ].map(([l, v]) => <div key={l as string} className={card}><p className="type-eyebrow text-ink-3">{l}</p><p className="tabular mt-2 text-2xl">{v}</p></div>)}
          </div>

          <section className={card}>
            <h2 className="text-sm font-medium">Sessions, page views and conversions per day</h2>
            {data.overview.daily.length === 0 ? <p className="mt-3 text-sm text-ink-3">No events in this range yet. Once the SDK collects visits (with visitor consent), they appear here.</p> : (
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.overview.daily}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--ink-3)" }} tickFormatter={(d: string) => d.slice(5)} minTickGap={20} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--ink-3)" }} width={36} />
                    <Tooltip {...tooltip} />
                    <Area type="monotone" dataKey="page_views" name="Page views" stroke="#6b7a8f" fill="#6b7a8f" fillOpacity={0.12} />
                    <Area type="monotone" dataKey="sessions" name="Sessions" stroke="#a67c3d" fill="#a67c3d" fillOpacity={0.2} />
                    <Area type="monotone" dataKey="conversions" name="Conversions" stroke="#1e6b3a" fill="#1e6b3a" fillOpacity={0.25} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className={card}>
              <h2 className="text-sm font-medium">Conversion funnel (sessions)</h2>
              <ol className="mt-4 space-y-3">
                {data.funnel.map((s, i) => (
                  <li key={s.key}>
                    <div className="flex justify-between text-sm"><span>{i + 1}. {s.label}</span><span className="tabular">{s.sessions}{i > 0 && <span className="text-ink-3"> · {(s.rate * 100).toFixed(1)}% of {s.denominator}</span>}</span></div>
                    <div className="mt-1 h-2 rounded-full bg-fill"><div className="h-full rounded-full bg-brand" style={{ width: `${data.funnel[0].sessions ? (s.sessions / data.funnel[0].sessions) * 100 : 0}%` }} /></div>
                    {i > 0 && s.dropOff > 0 && <p className="mt-0.5 text-[0.75rem] text-ink-3">{s.dropOff} sessions stopped before this step</p>}
                  </li>
                ))}
              </ol>
              <details className="mt-4 text-[0.75rem] text-ink-3"><summary className="cursor-pointer">Methodology</summary><p className="mt-1">A session counts at a step if it fired one of that step&rsquo;s events and reached every earlier step. Rate = sessions at this step ÷ sessions at the previous step. Events per step: {data.funnel.map((s) => `${s.label}: ${s.events.join(", ")}`).join("; ")}.</p></details>
            </section>
            <section className={card}>
              <h2 className="flex items-center gap-2 text-sm font-medium"><Lightbulb className="size-4 text-brand" /> Insights · {data.insights.period}</h2>
              <ul className="mt-3 space-y-3">
                {data.insights.items.map((i) => (
                  <li key={i.title} className={cn("rounded-2xl p-4 text-sm", i.level === "warning" ? "bg-danger-bg" : i.level === "opportunity" ? "bg-warn-bg" : "bg-fill")}>
                    <p className="font-medium">{i.title}</p><p className="mt-1 text-ink-2">{i.detail}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[0.75rem] text-ink-3">Insights describe observed patterns in your data, not proven causes.</p>
            </section>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Table title="Most visited pages" rows={data.overview.pages} cols={[["path", "Page"], ["views", "Views"], ["sessions", "Sessions"]]} />
            <Table title="Landing pages" rows={data.overview.landing} cols={[["path", "Page"], ["sessions", "Sessions"]]} />
            <Table title="Exit pages" rows={data.overview.exits} cols={[["path", "Page"], ["sessions", "Sessions"]]} />
            <Table title="Traffic sources" rows={data.overview.sources} cols={[["source", "Source"], ["sessions", "Sessions"], ["conversions", "Conv."]]} />
            <Table title="Campaigns (UTM)" rows={data.overview.campaigns} cols={[["campaign", "Campaign"], ["sessions", "Sessions"], ["property_views", "Property views"], ["conversions", "Conv."]]} />
            <Table title="Devices" rows={data.overview.devices} cols={[["device", "Device"], ["sessions", "Sessions"]]} />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className={card}>
              <h2 className="text-sm font-medium">Most-viewed properties</h2>
              {data.properties.top.length === 0 ? <p className="mt-3 text-sm text-ink-3">No property views yet.</p> : (
                <div className="mt-4 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.properties.top.slice(0, 8).map((p) => ({ name: (p.title ?? "Removed listing").slice(0, 18), views: p.views, clicks: p.card_clicks, showings: p.showing_requests }))} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "var(--ink-3)" }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "var(--ink-2)" }} width={120} />
                      <Tooltip {...tooltip} />
                      <Bar dataKey="views" name="Detail views" fill="#a67c3d" radius={[0, 6, 6, 0]} />
                      <Bar dataKey="clicks" name="Card clicks" fill="#6b7a8f" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>
            <Table title="Property views followed by a contact action (same session)" rows={data.properties.contacted} cols={[["title", "Home"], ["sessions_viewed", "Sessions viewing"], ["sessions_contacted", "Then contacted"]]} />
            <Table title="Common journeys" rows={data.journeys} cols={[["journey", "Journey (first steps)"], ["sessions", "Sessions"], ["converted", "Converted"]]} />
            <div className="grid gap-6">
              <Table title="Filters used" rows={data.properties.filters} cols={[["filter", "Filter"], ["uses", "Uses"]]} />
              <Table title="Price ranges searched" rows={data.properties.priceBands} cols={[["band", "Band"], ["searches", "Searches"]]} />
              <Table title="Contact & conversion events" rows={data.conversions} cols={[["label", "Event"], ["count", "Count"]]} />
            </div>
          </div>
          <p className="text-[0.75rem] text-ink-3">
            *Visitors: distinct pseudonymous visitor ids of people who allowed analytics; each non-consenting session counts once, so this is an upper bound. Returning: consenting visitors with 2+ sessions or activity before this range. Sessions end after 30 minutes of inactivity. Engaged time = seconds the tab was visible. Ad blockers, consent choices and network failures mean real activity is higher than measured. {t!.events} events in range.
          </p>
        </>
      ))}

      <section className="space-y-4">
        <h2 className="type-headline">{isOwner ? "Your own listings & leads (agent view)" : "Your listings & leads"}</h2>
        {!agent ? <Skeleton className="h-40" /> : (
          <div className="grid gap-6 xl:grid-cols-3">
            <div className={card}><p className="type-eyebrow text-ink-3">Your listings</p><p className="mt-2 text-2xl">{agent.listingCount}</p><p className="mt-1 text-[0.8125rem] text-ink-2">Agent profile views: {agent.agentProfileViews}</p></div>
            <div className={card}><p className="type-eyebrow text-ink-3">Your leads in range</p><ul className="mt-2 space-y-1 text-sm">{agent.leads.length === 0 ? <li className="text-ink-3">None</li> : agent.leads.map((l) => <li key={l.status} className="flex justify-between capitalize"><span>{l.status}</span><span className="tabular">{l.n}</span></li>)}</ul></div>
            <Table title="Engagement on your listings" rows={agent.engagement.top} cols={[["title", "Home"], ["views", "Views"], ["saves", "Saves"], ["showing_requests", "Showings"]]} />
          </div>
        )}
        <p className="text-[0.75rem] text-ink-3">Agents see aggregate engagement on their own listings — never individual visitors&rsquo; browsing histories.</p>
      </section>
    </div>
  );
}
