"use client";

import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Download, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/client-api";
import { track } from "@/lib/analytics-client";
import { cn } from "@/lib/utils";
import { MarketLab } from "./market-lab";

/**
 * Customer market intelligence. Every chart is drawn from stored public observations:
 * FRED (Freddie Mac, FHFA, Census/HUD, Realtor.com) plus government datasets downloaded
 * straight from the agencies — Census ACS and Building Permits, BLS unemployment, FHFA
 * county price indexes. Missing series are shown as unavailable — never estimated.
 */

interface Series {
  id: string;
  metric: string;
  title: string;
  units: string;
  geography: string;
  geoLevel: string;
  frequency: string;
  source: string;
  originalSource: string;
  sourceUrl: string;
  notes: string;
  lastFetchedAt: string | null;
  lastError: string | null;
  dataset: string | null;
  latest: { period: string; value: number; moe: number | null } | null;
  stale: boolean;
  observations: { period: string; value: number; moe: number | null }[];
}

interface Dataset {
  dataset: string;
  agency: string;
  title: string;
  sourceFiles: { url: string; bytes: number; sha256: string }[];
  retrievedAt: string;
  observations: number;
}

const METRICS: { key: string; label: string; explain: string; indexed?: boolean }[] = [
  { key: "median_list_price", label: "Median listing price", explain: "The middle asking price of homes listed for sale. Asking prices, not sale prices." },
  { key: "active_listings", label: "Homes for sale (inventory)", explain: "How many homes were actively listed. Lower inventory usually means more competition for buyers." },
  { key: "days_on_market", label: "Days on market", explain: "The typical number of days listings stay on the market. Fewer days usually signals faster sales." },
  { key: "new_listings", label: "New listings", explain: "Homes newly listed each month." },
  { key: "hpi", label: "Home price index", explain: "FHFA repeat-sales index: how prices of the same homes changed over time. Shown indexed to 100 at the start of the selected range so Maine and the U.S. compare fairly.", indexed: true },
  { key: "mortgage_rate", label: "30-year mortgage rate", explain: "Freddie Mac's weekly national average for 30-year fixed loans. Individual quotes vary." },
  { key: "unemployment_rate", label: "Unemployment", explain: "U.S. Bureau of Labor Statistics, monthly and not seasonally adjusted — compare the same month across years. The newest month is preliminary." },
  { key: "building_permits", label: "New homes permitted", explain: "U.S. Census Bureau Building Permits Survey: new housing units authorized each year. A leading signal of future supply." },
  { key: "hpi_county", label: "County price index", explain: "FHFA annual house price index for Kennebec and Somerset counties and Maine, downloaded from fhfa.gov. Indexed to 100 at the start of the selected range so areas compare fairly.", indexed: true },
];
const GEO_COLORS: Record<string, string> = { "Kennebec County, ME": "#a67c3d", "Somerset County, ME": "#7a5c99", Maine: "#1f3a32", "United States": "#6b7a8f" };
const PROFILE_GEOS = ["Waterville", "Augusta", "Winslow", "Oakland", "Sidney", "Belgrade", "Fairfield", "Kennebec County, ME", "Somerset County, ME", "Maine", "United States"];
const PROFILE_METRICS = [
  { key: "median_home_value", label: "Median home value" },
  { key: "median_gross_rent", label: "Median rent" },
  { key: "median_household_income", label: "Median household income" },
  { key: "homeownership_rate", label: "Homeownership" },
  { key: "population", label: "Population" },
];
const RANGES = [
  { label: "1Y", years: 1 },
  { label: "3Y", years: 3 },
  { label: "5Y", years: 5 },
  { label: "10Y", years: 10 },
];

function fmt(value: number, units: string): string {
  if (units === "dollars") return `$${Math.round(value).toLocaleString("en-US")}`;
  if (units === "percent") return `${value.toFixed(2)}%`;
  if (units.startsWith("index")) return value.toFixed(1);
  return `${Math.round(value).toLocaleString("en-US")}${units === "days" ? " days" : ""}`;
}

function yoy(s: Series): number | null {
  if (!s.latest) return null;
  const target = new Date(`${s.latest.period}T00:00:00Z`);
  target.setUTCFullYear(target.getUTCFullYear() - 1);
  const t = target.toISOString().slice(0, 10);
  const prior = [...s.observations].reverse().find((o) => o.period <= t);
  if (!prior || prior.value === 0) return null;
  return (s.latest.value - prior.value) / prior.value;
}

/** Change in percentage points vs. the same period a year earlier (for rates). */
function yoyPoints(s: Series): number | null {
  if (!s.latest) return null;
  const t = `${Number(s.latest.period.slice(0, 4)) - 1}${s.latest.period.slice(4)}`;
  const prior = s.observations.find((o) => o.period === t);
  return prior ? s.latest.value - prior.value : null;
}

export function MarketDashboard() {
  const [data, setData] = useState<{ series: Series[]; newestFetch: string | null } | null>(null);
  const [error, setError] = useState("");
  const [metric, setMetric] = useState("median_list_price");
  const [range, setRange] = useState(5);

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  useEffect(() => {
    api<{ series: Series[]; newestFetch: string | null }>("/api/market?years=10")
      .then(setData)
      .catch(() => setError("Market data couldn't be loaded right now."));
    api<{ datasets: Dataset[] }>("/api/market/datasets")
      .then((d) => setDatasets(d.datasets))
      .catch(() => undefined);
  }, []);
  useEffect(() => track("market_view", { metric }), [metric]);

  const def = METRICS.find((m) => m.key === metric)!;
  const selected = useMemo(() => (data?.series ?? []).filter((s) => s.metric === metric), [data, metric]);
  const chart = useMemo(() => {
    // The window ends at the newest observation (not "now"), so the chart is the same on the server and in the browser.
    const newest = selected.reduce((max, s) => (s.observations.at(-1)?.period ?? "") > max ? s.observations.at(-1)!.period : max, "");
    const fromIso = newest ? `${Number(newest.slice(0, 4)) - range}${newest.slice(4)}` : "";
    const rows = new Map<string, Record<string, number | string>>();
    for (const s of selected) {
      const obs = s.observations.filter((o) => o.period >= fromIso);
      const base = obs[0]?.value;
      for (const o of obs) {
        const row = rows.get(o.period) ?? { period: o.period };
        row[s.geography] = def.indexed && base ? Math.round((o.value / base) * 1000) / 10 : o.value;
        rows.set(o.period, row);
      }
    }
    return [...rows.values()].sort((a, b) => String(a.period).localeCompare(String(b.period)));
  }, [selected, range, def.indexed]);

  const acs = (data?.series ?? []).filter((s) => s.dataset === "acs5");
  const acsValue = (metricKey: string, geo: string) => acs.find((x) => x.metric === metricKey && x.geography === geo)?.latest ?? null;
  const acsRetrieved = datasets.find((d) => d.dataset === "acs5")?.retrievedAt;

  function downloadCsv() {
    const geos = selected.map((s) => s.geography);
    const lines = [["period", ...geos].join(","), ...chart.map((r) => [r.period, ...geos.map((g) => r[g] ?? "")].join(","))];
    lines.push("", `"Sources: ${selected.map((s) => `${s.geography}: ${s.originalSource} (${s.sourceUrl})`).join("; ")}"`);
    if (def.indexed) lines.push('"Values indexed to 100 at the first period in range."');
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `surette-market-${metric}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (error) return <p className="rounded-2xl bg-warn-bg p-5 text-warn">{error}</p>;
  if (!data) return <Skeleton className="h-[520px] w-full rounded-[28px]" />;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="no-scrollbar flex gap-2 overflow-x-auto" role="tablist" aria-label="Metric">
          {METRICS.map((m) => (
            <button key={m.key} role="tab" aria-selected={metric === m.key} type="button" onClick={() => setMetric(m.key)} className={cn("pressable shrink-0 rounded-full border px-4 py-2 text-sm", metric === m.key ? "border-ink bg-ink text-paper" : "border-line-strong hover:bg-fill")}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-full bg-fill p-1" role="group" aria-label="Date range">
            {RANGES.map((r) => (
              <button key={r.label} type="button" aria-pressed={range === r.years} onClick={() => setRange(r.years)} className={cn("rounded-full px-3 py-1 text-[0.8125rem]", range === r.years && "bg-paper shadow-sm")}>{r.label}</button>
            ))}
          </div>
          <button type="button" onClick={downloadCsv} className="pressable flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-[0.8125rem]"><Download className="size-3.5" aria-hidden /> CSV</button>
        </div>
      </div>

      <div className={cn("grid gap-3 sm:grid-cols-2", selected.length > 3 ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
        {selected.map((s) => {
          const change = yoy(s);
          return (
            <div key={s.id} className="rounded-[22px] bg-paper p-5 ring-1 ring-line">
              <p className="type-eyebrow text-ink-3">{s.geography}</p>
              <p className="tabular mt-2 text-2xl">{s.latest ? fmt(s.latest.value, s.units) : "Unavailable"}</p>
              <p className="mt-1 text-[0.8125rem] text-ink-2">
                {s.latest ? `${s.frequency === "weekly" ? "Week of" : "Period"} ${s.latest.period}` : s.lastError ?? "Not loaded yet"}
                {change !== null && s.units !== "percent" && <span className={cn("ml-2", change >= 0 ? "text-success" : "text-danger")}>{change >= 0 ? "▲" : "▼"} {(Math.abs(change) * 100).toFixed(1)}% vs. a year earlier</span>}
                {s.units === "percent" && yoyPoints(s) !== null && <span className="ml-2 text-ink-2">{yoyPoints(s)! >= 0 ? "▲" : "▼"} {Math.abs(yoyPoints(s)!).toFixed(1)} pt vs. a year earlier</span>}
              </p>
              {s.stale && <p className="mt-2 flex items-center gap-1 text-[0.75rem] text-warn"><AlertTriangle className="size-3" aria-hidden /> Older than usual for this series</p>}
            </div>
          );
        })}
      </div>

      <div className="rounded-[28px] bg-paper p-5 ring-1 ring-line sm:p-7">
        <p className="type-headline">{def.label}{def.indexed ? " (indexed: start of range = 100)" : ""}</p>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">{def.explain}</p>
        {chart.length ? (
          <div className="mt-6 h-[340px]" role="img" aria-label={`${def.label} over the last ${range} years for ${selected.map((s) => s.geography).join(", ")}`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 11, fill: "var(--ink-3)" }} tickFormatter={(p: string) => p.slice(0, 7)} minTickGap={40} />
                <YAxis tick={{ fontSize: 11, fill: "var(--ink-3)" }} width={70} tickFormatter={(v: number) => (selected[0]?.units === "dollars" && !def.indexed ? `$${Math.round(v / 1000)}K` : String(v))} domain={["auto", "auto"]} />
                <Tooltip contentStyle={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 12, fontSize: 12 }} formatter={(v, name) => [def.indexed ? Number(v).toFixed(1) : fmt(Number(v), selected[0]?.units ?? ""), String(name)]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {selected.map((s) => (
                  <Line key={s.id} type="monotone" dataKey={s.geography} stroke={GEO_COLORS[s.geography] ?? "#888"} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="mt-6 rounded-2xl bg-fill p-6 text-sm text-ink-2">No data is available for this metric yet. We show nothing rather than estimates.</p>
        )}
        <p className="mt-4 text-[0.75rem] text-ink-3">Historical data only. Past trends don&rsquo;t predict future values of any particular home.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {selected.map((s) => (
          <div key={s.id} className="rounded-[22px] bg-paper p-5 text-sm ring-1 ring-line">
            <p className="font-medium">{s.title} — {s.geography}</p>
            <dl className="mt-3 space-y-1 text-[0.8125rem] text-ink-2">
              <div><dt className="inline text-ink-3">Source: </dt><dd className="inline">{s.originalSource}</dd></div>
              <div><dt className="inline text-ink-3">Units: </dt><dd className="inline">{s.units} · {s.frequency}</dd></div>
              <div><dt className="inline text-ink-3">Retrieved: </dt><dd className="inline">{s.lastFetchedAt ? new Date(s.lastFetchedAt).toLocaleString("en-US") : "never"}</dd></div>
            </dl>
            <p className="mt-2 text-[0.75rem] text-ink-3">{s.notes}</p>
            <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-[0.8125rem] underline underline-offset-4">Original data <ExternalLink className="size-3" aria-hidden /></a>
          </div>
        ))}
      </div>

      <section className="rounded-[28px] bg-paper p-6 ring-1 ring-line" aria-labelledby="profile-h">
        <p id="profile-h" className="type-headline">Community profile</p>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          U.S. Census Bureau, American Community Survey 2020–2024 5-year estimates, downloaded from census.gov
          {acsRetrieved ? ` on ${new Date(acsRetrieved).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : ""}. The ± figure is the
          Census margin of error (90% confidence) — small towns have wide margins.
        </p>
        {acs.some((s) => s.latest) ? (
          <div className="mt-4 overflow-x-auto" data-lenis-prevent>
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-[0.75rem] uppercase tracking-[0.1em] text-ink-3">
                <tr>
                  <th className="py-2 text-left font-medium">Area</th>
                  {PROFILE_METRICS.map((m) => <th key={m.key} className="py-2 text-right font-medium">{m.label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {PROFILE_GEOS.map((g) => (
                  <tr key={g} className={cn(!g.includes(",") && g !== "Maine" && g !== "United States" ? "" : "bg-fill/40")}>
                    <th scope="row" className="py-2 pr-3 text-left font-normal">{g}</th>
                    {PROFILE_METRICS.map((m) => {
                      const v = acsValue(m.key, g);
                      const units = m.key === "homeownership_rate" ? "percent1" : m.key === "population" ? "people" : "dollars";
                      const show = (n: number) => (units === "percent1" ? `${n.toFixed(1)}%` : units === "dollars" ? `$${Math.round(n).toLocaleString("en-US")}` : Math.round(n).toLocaleString("en-US"));
                      return (
                        <td key={m.key} className="tabular py-2 text-right">
                          {v ? show(v.value) : "—"}
                          {v?.moe ? <span className="block text-[0.6875rem] text-ink-3">± {units === "percent1" ? `${v.moe.toFixed(1)} pt` : show(v.moe)}</span> : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[0.75rem] text-ink-3">Context only — never used to filter, rank or recommend homes or people. Rent is median gross rent (rent plus utilities).</p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-2">Not loaded yet. No estimates are shown in its place.</p>
        )}
      </section>

      <MarketLab />

      {datasets.length > 0 && (
        <section className="rounded-[28px] bg-paper p-6 ring-1 ring-line" aria-labelledby="sources-h">
          <p id="sources-h" className="type-headline">Government data sources</p>
          <ul className="mt-4 grid gap-4 md:grid-cols-2">
            {datasets.map((d) => (
              <li key={d.dataset} className="rounded-2xl bg-fill/60 p-4 text-[0.8125rem]">
                <p className="font-medium">{d.agency}</p>
                <p className="text-ink-2">{d.title}</p>
                <p className="mt-1 text-ink-3">{d.observations.toLocaleString("en-US")} values · downloaded {new Date(d.retrievedAt).toLocaleDateString("en-US")} · {d.sourceFiles.length} source file{d.sourceFiles.length === 1 ? "" : "s"}</p>
                <a href={d.sourceFiles[0]?.url.split(" ")[0].replace("api.bls.gov/publicAPI/v1/timeseries/data/", "www.bls.gov/lau/")} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 underline underline-offset-4">Agency source <ExternalLink className="size-3" aria-hidden /></a>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[0.75rem] text-ink-3">U.S. Government works, public domain. Exact file URLs and SHA-256 checksums: <a className="underline" href="/api/market/datasets">/api/market/datasets</a>.</p>
        </section>
      )}
      <p className="text-[0.75rem] text-ink-3">Data last refreshed {data.newestFetch ? new Date(data.newestFetch).toLocaleString("en-US") : "—"}. FRED series refresh daily; government datasets monthly.</p>
    </div>
  );
}
