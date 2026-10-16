"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiClientError } from "@/lib/client-api";
import { formatPrice } from "@/lib/money";
import type { Viewer } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CollectionsBoard } from "./collections-board";
import { useSaved } from "./saved-context";

type Tab = "overview" | "saved" | "searches" | "plans" | "privacy";

interface Overview {
  counts: { saved: number; searches: number; scenarios: number; comparisons: number };
  consents: { purpose: string; granted: boolean; recorded_at: string }[];
  agent: { full_name: string; email: string; phone: string | null } | null;
}
interface Deal { id: string; title: string; stageLabel: string; closingDate: string | null; agent: string | null; milestones: { label: string; dueOn: string | null; done: boolean }[] }
interface Search { id: string; name: string; criteria: Record<string, unknown>; createdAt: string }
interface History { id: number; criteria: Record<string, unknown>; resultCount: number; createdAt: string }
interface Scenario { id: string; name: string; inputs: Record<string, number | boolean>; sharedWithAgent: boolean; updatedAt: string }
interface Comparison { id: string; name: string; propertyIds: string[]; createdAt: string }

function criteriaLabel(c: Record<string, unknown>): string {
  const parts: string[] = [];
  if (c.city) parts.push(String(c.city));
  if (c.minBeds) parts.push(`${c.minBeds}+ bd`);
  if (c.maxPriceCents) parts.push(`under ${formatPrice(Number(c.maxPriceCents))}`);
  if (c.minGarage) parts.push("garage");
  if (c.type) parts.push(c.type === "rent" ? "for lease" : "for sale");
  if (Array.isArray(c.features) && c.features.length) parts.push((c.features as string[]).join(", "));
  return parts.join(" · ") || "Any home";
}
function criteriaHref(c: Record<string, unknown>): string {
  const q = new URLSearchParams();
  if (c.city) q.set("city", String(c.city));
  if (c.maxPriceCents) q.set("maxPrice", String(c.maxPriceCents));
  if (c.minBeds) q.set("minBeds", String(c.minBeds));
  if (c.type) q.set("type", String(c.type));
  return `/listings${q.size ? `?${q}` : ""}`;
}

export function AccountWorkspace({ viewer }: { viewer: Viewer }) {
  const router = useRouter();
  const { refreshViewer } = useSaved();
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [searches, setSearches] = useState<Search[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [comparisons, setComparisons] = useState<Comparison[]>([]);
  const [analytics, setAnalytics] = useState<"granted" | "denied" | "unset">("unset");
  const [password, setPassword] = useState("");
  const [deleteError, setDeleteError] = useState("");

  const load = useCallback(async () => {
    const [o, d, s, h, sc, c] = await Promise.all([
      api<Overview>("/api/account"),
      api<{ deals: Deal[] }>("/api/account/deals"),
      api<{ searches: Search[] }>("/api/account/searches"),
      api<{ history: History[] }>("/api/account/history"),
      api<{ scenarios: Scenario[] }>("/api/dual-move/scenarios"),
      api<{ comparisons: Comparison[] }>("/api/account/comparisons"),
    ]);
    setOverview(o);
    setDeals(d.deals);
    setSearches(s.searches);
    setHistory(h.history);
    setScenarios(sc.scenarios);
    setComparisons(c.comparisons);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
    try {
      const v = localStorage.getItem("sa_consent");
      setAnalytics(v === "granted" || v === "denied" ? v : "unset");
    } catch {
      // ignore
    }
  }, [load]);

  async function setAnalyticsConsent(granted: boolean) {
    const state = granted ? "granted" : "denied";
    try {
      if (window.SuretteAnalytics) window.SuretteAnalytics.consent(state);
      else localStorage.setItem("sa_consent", state);
    } catch {
      // ignore
    }
    setAnalytics(state);
    await api("/api/account/consent", { method: "POST", body: { purpose: "analytics", granted } }).catch(() => undefined);
  }

  async function deleteAccount(e: FormEvent) {
    e.preventDefault();
    if (!window.confirm("Delete your account and all saved data? This can't be undone.")) return;
    try {
      await api("/api/account", { method: "DELETE", body: { password } });
      await refreshViewer();
      router.replace("/?account=deleted");
    } catch (err) {
      setDeleteError(err instanceof ApiClientError ? err.message : "Couldn't delete the account.");
    }
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "saved", label: `Saved homes${overview ? ` · ${overview.counts.saved}` : ""}` },
    { key: "searches", label: "Searches & comparisons" },
    { key: "plans", label: "Sell & buy plans" },
    { key: "privacy", label: "Privacy & data" },
  ];

  return (
    <div>
      <div className="no-scrollbar flex gap-2 overflow-x-auto border-b border-line pb-3" role="tablist" aria-label="Account sections">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} type="button" onClick={() => setTab(t.key)} className={cn("pressable shrink-0 rounded-full px-4 py-2 text-sm", tab === t.key ? "bg-ink text-paper" : "hover:bg-fill")}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-8">
        {!overview ? (
          <Skeleton className="h-72 w-full rounded-[28px]" />
        ) : tab === "overview" ? (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <section className="rounded-[24px] bg-paper p-6 ring-1 ring-line" aria-labelledby="your-deal">
                <h2 id="your-deal" className="type-headline">Your purchase or sale</h2>
                {deals.length === 0 ? (
                  <p className="mt-2 text-sm text-ink-2">Once you&rsquo;re under way with an offer or listing, your milestones and closing date appear here.</p>
                ) : (
                  deals.map((d) => (
                    <div key={d.id} className="mt-4">
                      <p className="font-medium">{d.title}</p>
                      <p className="text-sm text-ink-2">Stage: {d.stageLabel}{d.closingDate ? ` · Closing ${d.closingDate}` : ""}{d.agent ? ` · Agent ${d.agent}` : ""}</p>
                      <ol className="mt-3 space-y-1.5 text-sm">
                        {d.milestones.map((m) => (
                          <li key={m.label} className="flex items-center gap-2">
                            <span className={cn("grid size-5 place-items-center rounded-full", m.done ? "bg-success text-white" : "border border-line-strong")} aria-hidden>{m.done && <Check className="size-3" />}</span>
                            <span className={cn(m.done && "text-ink-3 line-through")}>{m.label}</span>
                            {m.dueOn && <span className="ml-auto text-ink-3">{m.dueOn}</span>}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))
                )}
              </section>
              <div className="grid gap-3 sm:grid-cols-4">
                {[["Saved homes", overview.counts.saved, "saved"], ["Saved searches", overview.counts.searches, "searches"], ["Comparisons", overview.counts.comparisons, "searches"], ["Sell & buy plans", overview.counts.scenarios, "plans"]].map(([label, n, t]) => (
                  <button key={label as string} type="button" onClick={() => setTab(t as Tab)} className="pressable rounded-[20px] bg-paper p-4 text-left ring-1 ring-line hover:bg-fill">
                    <p className="text-2xl">{n as number}</p>
                    <p className="text-[0.8125rem] text-ink-2">{label as string}</p>
                  </button>
                ))}
              </div>
            </div>
            <aside className="rounded-[24px] bg-paper p-6 ring-1 ring-line">
              <h2 className="type-headline">Your agent</h2>
              {overview.agent ? (
                <div className="mt-3 text-sm">
                  <p className="font-medium">{overview.agent.full_name}</p>
                  <p><a href={`mailto:${overview.agent.email}`} className="underline underline-offset-4">{overview.agent.email}</a></p>
                  {overview.agent.phone && <p><a href={`tel:${overview.agent.phone}`} className="underline underline-offset-4">{overview.agent.phone}</a></p>}
                  <p className="mt-3 text-ink-2">Your saved homes and comments are shared live with your agent in Collections.</p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-ink-2">An agent will be assigned when you reach out.</p>
              )}
            </aside>
          </div>
        ) : tab === "saved" ? (
          <CollectionsBoard viewer={viewer} />
        ) : tab === "searches" ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-[24px] bg-paper p-6 ring-1 ring-line">
              <h2 className="type-headline">Saved searches</h2>
              {searches.length === 0 ? <p className="mt-2 text-sm text-ink-2">Ask the concierge for homes, then choose &ldquo;Save this search&rdquo;.</p> : (
                <ul className="mt-3 divide-y divide-line text-sm">
                  {searches.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                      <Link href={criteriaHref(s.criteria)} className="hover:underline"><span className="font-medium">{s.name}</span><span className="block text-ink-2">{criteriaLabel(s.criteria)}</span></Link>
                      <button type="button" aria-label={`Delete ${s.name}`} onClick={async () => { await api(`/api/account/searches?id=${s.id}`, { method: "DELETE" }); void load(); }} className="pressable grid size-8 place-items-center rounded-full text-ink-3 hover:text-danger"><Trash2 className="size-4" /></button>
                    </li>
                  ))}
                </ul>
              )}
              <h2 className="type-headline mt-8">Comparisons</h2>
              {comparisons.length === 0 ? <p className="mt-2 text-sm text-ink-2">Compare homes from any listing page or the concierge.</p> : (
                <ul className="mt-3 divide-y divide-line text-sm">
                  {comparisons.map((c) => <li key={c.id} className="py-2.5"><Link href={`/compare?ids=${c.propertyIds.join(",")}`} className="hover:underline">{c.name} · {c.propertyIds.length} homes</Link></li>)}
                </ul>
              )}
            </section>
            <section className="rounded-[24px] bg-paper p-6 ring-1 ring-line">
              <div className="flex items-center justify-between">
                <h2 className="type-headline">Recent searches</h2>
                {history.length > 0 && <button type="button" onClick={async () => { await api("/api/account/history", { method: "DELETE" }); void load(); }} className="text-[0.8125rem] underline underline-offset-4">Clear history</button>}
              </div>
              {history.length === 0 ? <p className="mt-2 text-sm text-ink-2">Searches you run with the concierge while signed in appear here. Only you can see them.</p> : (
                <ul className="mt-3 divide-y divide-line text-sm">
                  {history.map((h) => <li key={h.id} className="flex justify-between gap-3 py-2"><Link href={criteriaHref(h.criteria)} className="hover:underline">{criteriaLabel(h.criteria)}</Link><span className="shrink-0 text-ink-3">{h.resultCount} results</span></li>)}
                </ul>
              )}
            </section>
          </div>
        ) : tab === "plans" ? (
          <section className="rounded-[24px] bg-paper p-6 ring-1 ring-line">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="type-headline">Saved sell & buy plans</h2>
              <Link href="/dual-move" className="text-sm underline underline-offset-4">Open the Dual-Move Copilot →</Link>
            </div>
            {scenarios.length === 0 ? <p className="mt-2 text-sm text-ink-2">Save a scenario from the Dual-Move Copilot to keep it here.</p> : (
              <ul className="mt-4 divide-y divide-line text-sm">
                {scenarios.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="font-medium">{s.name}</p>
                      <p className="text-ink-2">Sell {formatPrice(Number(s.inputs.homeValueCents))} → buy {formatPrice(Number(s.inputs.newPriceCents))} · {s.inputs.sellFirst ? "sell first" : "buy first"}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 text-[0.8125rem]">Share with my agent <Switch checked={s.sharedWithAgent} onCheckedChange={async (v) => { await api(`/api/dual-move/scenarios/${s.id}`, { method: "PATCH", body: { sharedWithAgent: v } }); void load(); }} aria-label={`Share ${s.name} with my agent`} /></label>
                      <button type="button" aria-label={`Delete ${s.name}`} onClick={async () => { await api(`/api/dual-move/scenarios/${s.id}`, { method: "DELETE" }); void load(); }} className="pressable grid size-8 place-items-center rounded-full text-ink-3 hover:text-danger"><Trash2 className="size-4" /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-5 rounded-[24px] bg-paper p-6 ring-1 ring-line">
              <h2 className="type-headline">Your choices</h2>
              <label className="flex items-center justify-between gap-4 text-sm">
                <span><span className="font-medium">Anonymous site analytics on this device</span><span className="block text-ink-2">Page visits and clicks, measured on our own servers. Never what you type.</span></span>
                <Switch checked={analytics === "granted"} onCheckedChange={(v) => void setAnalyticsConsent(v)} aria-label="Allow anonymous site analytics" />
              </label>
              <p className="text-[0.8125rem] text-ink-3">Recorded choices: {overview.consents.map((c) => `${c.purpose.replace("_", " ")}: ${c.granted ? "yes" : "no"} (${new Date(c.recorded_at).toLocaleDateString("en-US")})`).join(" · ") || "none yet"}</p>
              <a href="/api/account/export" className="pressable inline-flex items-center gap-2 rounded-full border border-line-strong px-4 py-2 text-sm"><Download className="size-4" aria-hidden /> Download my data (JSON)</a>
              <p className="text-[0.8125rem] text-ink-2">Read the <Link href="/privacy" className="underline underline-offset-4">privacy notice</Link> for what we collect and how long we keep it.</p>
            </section>
            <form onSubmit={deleteAccount} className="space-y-4 rounded-[24px] bg-paper p-6 ring-1 ring-line">
              <h2 className="type-headline text-danger">Delete account</h2>
              <p className="text-sm text-ink-2">Permanently deletes your account, collections, searches, comparisons and plans. Requests you already sent to the team (showings, messages) stay with the brokerage; contact the office to erase those too.</p>
              <Field label="Confirm with your password" htmlFor="del-pw" error={deleteError}>
                <Input id="del-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </Field>
              <Button type="submit" variant="danger" disabled={!password}>Delete my account</Button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
