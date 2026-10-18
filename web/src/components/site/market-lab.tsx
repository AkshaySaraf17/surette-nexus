"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/client-api";
import { track } from "@/lib/analytics-client";
import { gapVerdict } from "@/lib/market-lab-verdict";
import { cn } from "@/lib/utils";

/**
 * Market Lab: what models trained on public data say about our towns. Results come from
 * ml/market_lab/build.py (Census ACS for all 529 Maine towns, FHFA price index), with the method and
 * error of every figure shown next to it. Context for buyers and sellers, never an appraisal.
 */

interface Lab {
  generated_at: string;
  regression: { best_model: string; typical_error_pct: number; models: { model: string; r2: number; median_abs_pct_error: number }[]; importance: { feature: string; importance: number }[] };
  clusters: { k: number; silhouette: number };
  cleaning: Record<string, number>;
  towns: { town: string; county: string; group: string; similar: { town: string; county: string; median_home_value: number }[]; median_home_value: number; median_home_value_moe: number; expected_home_value?: number; gap_pct?: number }[];
  price_index: { geo: string; model: string; history: { year: number; value: number }[]; projection: { year: number; central: number; low: number; high: number }[]; backtest_mape: Record<string, number> }[];
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${Math.round(Math.abs(n) * 100)}%`;
const GEO_LABEL: Record<string, string> = { kennebec: "Kennebec County", somerset: "Somerset County", maine: "Maine" };

function verdict(gap: number, err: number): { tone: string; text: string } {
  const v = gapVerdict(gap, err);
  if (v === "in_line") return { tone: "text-ink-2", text: `In line with towns that have similar incomes, rents and size — the difference is within the model's typical ±${pct(err)} error.` };
  if (v === "below") return { tone: "text-success", text: `About ${pct(gap)} lower than towns with similar incomes and rents usually have — more than the model's typical ±${pct(err)} error.` };
  return { tone: "text-warn", text: `About ${pct(gap)} higher than towns with similar incomes and rents usually have — more than the model's typical ±${pct(err)} error. Often a sign of things the census data doesn't capture, like lake frontage, land or newer homes.` };
}

export function MarketLab() {
  const [lab, setLab] = useState<Lab | null>(null);
  const [failed, setFailed] = useState(false);
  const [town, setTown] = useState("Waterville");
  const [geo, setGeo] = useState("kennebec");

  useEffect(() => {
    api<Lab>("/api/market/lab").then(setLab).catch(() => setFailed(true));
  }, []);

  const current = lab?.towns.find((t) => t.town === town) ?? lab?.towns[0];
  const outlook = lab?.price_index.find((p) => p.geo === geo);
  const chart = useMemo(() => {
    if (!outlook) return [];
    const last = outlook.history[outlook.history.length - 1];
    return [
      ...outlook.history.map((h) => ({ year: h.year, actual: h.value })),
      ...[{ year: last.year, central: last.value, band: [last.value, last.value] as [number, number] }, ...outlook.projection.map((p) => ({ year: p.year, central: p.central, band: [p.low, p.high] as [number, number] }))].map((p, i) => (i === 0 ? { ...p, actual: last.value } : p)),
    ].reduce<Record<string, unknown>[]>((rows, row) => {
      const existing = rows.find((r) => r.year === row.year);
      if (existing) Object.assign(existing, row);
      else rows.push({ ...row });
      return rows;
    }, []);
  }, [outlook]);

  if (failed) return null; // results not built on this server: the rest of the page still works
  if (!lab || !current) return null;
  const err = lab.regression.typical_error_pct;
  const best = lab.regression.models.find((m) => m.model === lab.regression.best_model);

  return (
    <section className="rounded-[28px] bg-paper p-6 ring-1 ring-line" aria-labelledby="lab-h">
      <p className="type-eyebrow text-gold">Market Lab</p>
      <h2 id="lab-h" className="type-headline mt-1">Our towns, analyzed against all {lab.cleaning.raw_rows} Maine towns</h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-2">
        Statistical models trained on public Census and FHFA data. Each figure shows its method and typical error. This is context for decisions, not an appraisal of any home.
      </p>

      <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Choose a town">
        {lab.towns.map((t) => (
          <button key={t.town} type="button" aria-pressed={t.town === current.town} onClick={() => { setTown(t.town); track("market_view", { metric: `lab:${t.town.toLowerCase()}` }); }} className={cn("pressable rounded-full px-3.5 py-1.5 text-sm ring-1", t.town === current.town ? "bg-ink text-paper ring-ink" : "bg-paper ring-line")}>
            {t.town}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl bg-fill/60 p-5">
          <p className="text-[0.75rem] uppercase tracking-[0.12em] text-ink-3">Towns most like {current.town}</p>
          <p className="mt-1 text-sm text-ink-2">Group: <span className="font-medium text-ink">{current.group}</span></p>
          <ol className="mt-3 space-y-1.5 text-sm">
            {current.similar.map((s, i) => (
              <li key={s.town} className="flex justify-between gap-3"><span>{i + 1}. {s.town} <span className="text-ink-3">({s.county})</span></span><span className="tabular text-ink-2">{money(s.median_home_value)}</span></li>
            ))}
          </ol>
          <p className="mt-3 text-[0.75rem] text-ink-3">Nearest neighbours on home value, income, rent, ownership, seasonal homes, resident and housing age, and size (standardized). Groups: K-Means, {lab.clusters.k} groups; Maine towns form a continuum, so groups are rough summaries.</p>
        </div>

        <div className="rounded-2xl bg-fill/60 p-5">
          <p className="text-[0.75rem] uppercase tracking-[0.12em] text-ink-3">Home values vs. local incomes and rents</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-ink-3">Census median home value</dt><dd className="tabular text-lg">{money(current.median_home_value)}<span className="block text-[0.6875rem] text-ink-3">± {money(current.median_home_value_moe)}</span></dd></div>
            {current.expected_home_value !== undefined && <div><dt className="text-ink-3">Typical for similar towns</dt><dd className="tabular text-lg">{money(current.expected_home_value)}<span className="block text-[0.6875rem] text-ink-3">model estimate</span></dd></div>}
          </dl>
          {current.gap_pct !== undefined && <p className={cn("mt-3 text-sm", verdict(current.gap_pct, err).tone)}>{verdict(current.gap_pct, err).text}</p>}
          <p className="mt-3 text-[0.75rem] text-ink-3">
            {lab.regression.best_model} trained on {lab.cleaning.model_towns} towns; each town is estimated by a model that never saw it (cross-validation). Explains {best ? Math.round(best.r2 * 100) : "—"}% of the variation between towns.
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-2xl bg-fill/60 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-[0.75rem] uppercase tracking-[0.12em] text-ink-3">House price index outlook</p>
          <div className="flex gap-1.5" role="group" aria-label="Choose an area">
            {lab.price_index.map((p) => (
              <button key={p.geo} type="button" aria-pressed={p.geo === geo} onClick={() => setGeo(p.geo)} className={cn("pressable rounded-full px-3 py-1 text-[0.8125rem] ring-1", p.geo === geo ? "bg-ink text-paper ring-ink" : "bg-paper ring-line")}>{GEO_LABEL[p.geo] ?? p.geo}</button>
            ))}
          </div>
        </div>
        {outlook && (
          <>
            <div className="mt-3 h-64" data-lenis-prevent>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} minTickGap={28} />
                  <YAxis tick={{ fontSize: 11 }} width={44} domain={["auto", "auto"]} />
                  <Tooltip formatter={(v) => (Array.isArray(v) ? `${v[0]}–${v[1]}` : String(v))} />
                  <Area type="monotone" dataKey="band" stroke="none" fill="#a67c3d" fillOpacity={0.2} name="Likely range" isAnimationActive={false} />
                  <Line type="monotone" dataKey="actual" stroke="var(--ink)" dot={false} strokeWidth={2} name="FHFA index" isAnimationActive={false} />
                  <Line type="monotone" dataKey="central" stroke="#a67c3d" strokeDasharray="5 4" dot={false} strokeWidth={2} name="Outlook" isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-sm text-ink-2">
              {outlook.projection.map((p) => `${p.year}: ${p.central} (likely ${p.low}–${p.high})`).join(" · ")}
            </p>
            <p className="mt-2 text-[0.75rem] text-ink-3">
              FHFA all-transactions index (2000 = 100). Model: {outlook.model}, chosen by backtesting five methods on every year since 2005; its average error was ±{(outlook.backtest_mape["1"] * 100).toFixed(1)}% one year ahead and ±{(outlook.backtest_mape["2"] * 100).toFixed(1)}% two years ahead. The range is the 10th–90th percentile of those past errors. It describes the area index, not any single home, and isn&rsquo;t financial advice.
            </p>
          </>
        )}
      </div>

      <details className="mt-5 text-sm">
        <summary className="cursor-pointer font-medium">What drives home values across Maine towns?</summary>
        <ol className="mt-3 space-y-1">
          {lab.regression.importance.slice(0, 5).map((f) => <li key={f.feature}>{f.feature}</li>)}
        </ol>
        <p className="mt-3 text-[0.75rem] text-ink-3">
          Ranked by permutation importance. Models compared with nested cross-validation:{" "}
          {lab.regression.models.map((m) => `${m.model} R² ${m.r2.toFixed(2)}`).join(" · ")}. Built {new Date(lab.generated_at).toLocaleDateString("en-US")} from Census ACS 2020–2024 and FHFA data.
        </p>
      </details>
    </section>
  );
}
