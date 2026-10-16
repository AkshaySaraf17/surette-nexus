"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Download, Printer, Save, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/client-api";
import { track } from "@/lib/analytics-client";
import { analyze, agentBriefing, dualMoveInputSchema, money, toCsv, type DualMoveInput } from "@/lib/dual-move";
import { dollarsToCents } from "@/lib/money";
import { CONTACT_CONSENT_TEXT } from "@/lib/privacy";
import { cn } from "@/lib/utils";
import { useSaved } from "./saved-context";

/**
 * Dual-Move Copilot. Every number recalculates instantly in the browser from the same
 * deterministic module the server uses (src/lib/dual-move.ts). Users enter their own
 * assumptions; nothing is looked up or guessed.
 */

type Form = Record<string, string> & { sellFirst: string };

const FIELDS: { key: string; label: string; kind: "money" | "pct" | "int"; hint?: string; group: "sell" | "buy" | "costs" | "plan" }[] = [
  { key: "homeValue", label: "Estimated value of your current home", kind: "money", group: "sell" },
  { key: "mortgageBalance", label: "Remaining mortgage balance", kind: "money", group: "sell" },
  { key: "sellingCost", label: "Selling costs (%)", kind: "pct", hint: "Commission, transfer tax, closing costs — your estimate.", group: "sell" },
  { key: "prep", label: "Repairs & preparation", kind: "money", group: "sell" },
  { key: "newPrice", label: "Price of the home you want", kind: "money", group: "buy" },
  { key: "savings", label: "Cash savings available", kind: "money", group: "buy" },
  { key: "downPayment", label: "Down payment (%)", kind: "pct", group: "buy" },
  { key: "buyerClosing", label: "Buyer closing costs (%)", kind: "pct", hint: "Lender and title fees — ask your lender.", group: "buy" },
  { key: "rate", label: "Mortgage interest rate (%)", kind: "pct", hint: "Use a quote from your lender.", group: "buy" },
  { key: "term", label: "Loan term (years)", kind: "int", group: "buy" },
  { key: "tax", label: "Property taxes per year", kind: "money", group: "costs" },
  { key: "insurance", label: "Homeowners insurance per year", kind: "money", group: "costs" },
  { key: "hoa", label: "HOA fees per month", kind: "money", group: "costs" },
  { key: "moving", label: "Moving expenses", kind: "money", group: "costs" },
  { key: "timeline", label: "Timeline (months)", kind: "int", group: "plan" },
  { key: "overlap", label: "Months owning both homes (if buying first)", kind: "int", group: "plan" },
  { key: "currentHousing", label: "Current monthly housing cost", kind: "money", hint: "Mortgage, taxes, insurance — carried during any overlap.", group: "plan" },
  { key: "bridgeRate", label: "Bridge financing rate (%)", kind: "pct", group: "plan" },
];

const EMPTY: Form = Object.fromEntries(FIELDS.map((f) => [f.key, ""])) as Form;
const EXAMPLE: Form = {
  homeValue: "420,000", mortgageBalance: "180,000", sellingCost: "6", prep: "8,000", newPrice: "560,000", savings: "40,000", downPayment: "20", buyerClosing: "3",
  rate: "", term: "30", tax: "7,800", insurance: "1,900", hoa: "0", moving: "6,000", timeline: "6", overlap: "2", currentHousing: "2,100", bridgeRate: "", sellFirst: "true",
};

/** "6.5" → 650 bps, exactly (string parsing, no floats). */
function pctToBps(v: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(v.trim().replace(/%$/, ""));
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")) : null;
}

function toInputs(f: Form): { inputs: DualMoveInput | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const val = (key: string, kind: "money" | "pct" | "int"): number => {
    const raw = f[key].trim();
    if (!raw) {
      errors[key] = "Required";
      return 0;
    }
    const n = kind === "money" ? dollarsToCents(raw) : kind === "pct" ? pctToBps(raw) : /^\d+$/.test(raw) ? Number(raw) : null;
    if (n === null) {
      errors[key] = kind === "money" ? "Dollar amount, e.g. 420,000" : kind === "pct" ? "Percent, e.g. 6.5" : "Whole number";
      return 0;
    }
    return n;
  };
  const raw = {
    homeValueCents: val("homeValue", "money"),
    mortgageBalanceCents: val("mortgageBalance", "money"),
    sellingCostBps: val("sellingCost", "pct"),
    prepCostsCents: val("prep", "money"),
    newPriceCents: val("newPrice", "money"),
    savingsCents: val("savings", "money"),
    downPaymentBps: val("downPayment", "pct"),
    buyerClosingCostBps: val("buyerClosing", "pct"),
    rateBps: val("rate", "pct"),
    termYears: val("term", "int"),
    propertyTaxAnnualCents: val("tax", "money"),
    insuranceAnnualCents: val("insurance", "money"),
    hoaMonthlyCents: val("hoa", "money"),
    movingCostsCents: val("moving", "money"),
    timelineMonths: val("timeline", "int"),
    sellFirst: f.sellFirst === "true",
    overlapMonths: f.sellFirst === "true" ? 0 : val("overlap", "int"),
    currentMonthlyHousingCents: f.sellFirst === "true" ? 0 : val("currentHousing", "money"),
    bridgeRateBps: f.sellFirst === "true" ? 0 : val("bridgeRate", "pct"),
  };
  if (Object.keys(errors).length) return { inputs: null, errors };
  const parsed = dualMoveInputSchema.safeParse(raw);
  if (!parsed.success) {
    const map: Record<string, string> = { homeValueCents: "homeValue", mortgageBalanceCents: "mortgageBalance", sellingCostBps: "sellingCost", newPriceCents: "newPrice", downPaymentBps: "downPayment", buyerClosingCostBps: "buyerClosing", rateBps: "rate", termYears: "term", timelineMonths: "timeline", overlapMonths: "overlap", bridgeRateBps: "bridgeRate" };
    for (const issue of parsed.error.issues) errors[map[String(issue.path[0])] ?? String(issue.path[0])] ??= issue.message;
    return { inputs: null, errors };
  }
  return { inputs: parsed.data, errors };
}

const STORAGE_KEY = "sn_dual_move_draft";

export function DualMoveCopilot({ referenceRate }: { referenceRate: { value: number; period: string; retrievedAt: string } | null }) {
  const { viewer } = useSaved();
  const [form, setForm] = useState<Form>({ ...EMPTY, term: "30", sellFirst: "true" });
  const [explanation, setExplanation] = useState<{ text: string; engine: string } | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saved, setSaved] = useState("");
  const [share, setShare] = useState({ open: false, name: "", email: "", phone: "", message: "", consent: false, state: "idle" as "idle" | "sending" | "done", errors: {} as Record<string, string>, error: "" });

  // Restore an unsent draft (per-browser convenience only).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
       
      if (raw) setForm({ ...EMPTY, ...JSON.parse(raw) });
    } catch {
      // ignore
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
    } catch {
      // ignore
    }
  }, [form]);

  const { inputs, errors } = useMemo(() => toInputs(form), [form]);
  const result = useMemo(() => (inputs ? analyze(inputs) : null), [inputs]);
  const touched = Object.entries(form).filter(([k, v]) => k !== "sellFirst" && k !== "term" && v).length;

  useEffect(() => {
    if (result) track("dual_move_calculate", { scenarios: result.scenarios.length });
  }, [result]);

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setExplanation(null);
  };

  async function explain() {
    if (!inputs) return;
    setExplaining(true);
    try {
      const data = await api<{ explanation: { text: string; engine: string } }>("/api/dual-move/analyze", { method: "POST", body: { inputs, explain: true } });
      setExplanation(data.explanation);
    } finally {
      setExplaining(false);
    }
  }

  function download(name: string, content: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveScenario(e: FormEvent) {
    e.preventDefault();
    if (!inputs) return;
    try {
      await api("/api/dual-move/scenarios", { method: "POST", body: { name: saveName || "My plan", inputs } });
      setSaved("Saved to your account.");
    } catch (err) {
      setSaved(err instanceof ApiClientError ? err.message : "Couldn't save.");
    }
  }

  async function sendToAgent(e: FormEvent) {
    e.preventDefault();
    if (!inputs) return;
    setShare((s) => ({ ...s, state: "sending", errors: {}, error: "" }));
    try {
      await api("/api/dual-move/share", {
        method: "POST",
        body: { inputs, contactName: share.name, contactEmail: share.email || null, contactPhone: share.phone || null, message: share.message || null, consentContact: share.consent || undefined },
      });
      track("contact_submit", { source: "dual_move" });
      setShare((s) => ({ ...s, state: "done" }));
    } catch (err) {
      setShare((s) => ({ ...s, state: "idle", errors: err instanceof ApiClientError ? err.fields : {}, error: err instanceof Error ? err.message : "Couldn't send." }));
    }
  }

  const groups: { key: "sell" | "buy" | "costs" | "plan"; title: string }[] = [
    { key: "sell", title: "Your current home" },
    { key: "buy", title: "Your next home" },
    { key: "costs", title: "Ongoing & one-time costs" },
    { key: "plan", title: "Timing" },
  ];

  return (
    <div className="grid gap-10 lg:grid-cols-12">
      <form className="space-y-6 lg:col-span-5 print:hidden" onSubmit={(e) => e.preventDefault()} noValidate aria-label="Your assumptions">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-2">Enter your own numbers — results update as you type.</p>
          <button type="button" onClick={() => setForm(EXAMPLE)} className="text-sm underline underline-offset-4">Fill an example</button>
        </div>
        <fieldset className="rounded-[24px] bg-paper p-5 ring-1 ring-line">
          <legend className="sr-only">Plan</legend>
          <p className="text-[0.8125rem] font-medium text-ink-2">Which comes first?</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {[["true", "Sell first"], ["false", "Buy first"]].map(([v, label]) => (
              <label key={v} className={cn("pressable cursor-pointer rounded-2xl border px-4 py-3 text-center text-sm", form.sellFirst === v ? "border-ink bg-ink text-paper" : "border-line-strong")}>
                <input type="radio" name="sellFirst" value={v} checked={form.sellFirst === v} onChange={() => setForm((f) => ({ ...f, sellFirst: v }))} className="sr-only" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {groups.map((g) => (
          <fieldset key={g.key} className="space-y-4 rounded-[24px] bg-paper p-5 ring-1 ring-line">
            <legend className="type-headline px-1">{g.title}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {FIELDS.filter((f) => f.group === g.key && (form.sellFirst !== "true" || !["overlap", "currentHousing", "bridgeRate"].includes(f.key))).map((f) => (
                <Field
                  key={f.key}
                  label={f.label}
                  htmlFor={`dm-${f.key}`}
                  error={touched > 2 ? errors[f.key] : undefined}
                  hint={
                    f.key === "rate" && referenceRate ? (
                      <>
                        For reference, the Freddie Mac national 30-year average was {referenceRate.value.toFixed(2)}% for the week of {referenceRate.period} (via FRED). Your quote may differ.{" "}
                        <button type="button" className="underline underline-offset-2" onClick={() => setForm((x) => ({ ...x, rate: referenceRate.value.toFixed(2) }))}>Use it</button>
                      </>
                    ) : (
                      f.hint
                    )
                  }
                  className={f.hint ? "sm:col-span-2" : undefined}
                >
                  <Input id={`dm-${f.key}`} inputMode="decimal" value={form[f.key]} onChange={set(f.key)} placeholder={f.kind === "money" ? "$" : f.kind === "pct" ? "%" : ""} aria-invalid={touched > 2 && Boolean(errors[f.key])} />
                </Field>
              ))}
            </div>
          </fieldset>
        ))}
      </form>

      <section className="lg:col-span-7" aria-label="Results" aria-live="polite">
        {!result ? (
          <div className="sticky top-24 rounded-[28px] border border-dashed border-line-strong p-10 text-center">
            <p className="type-headline">Your scenarios appear here</p>
            <p className="mt-2 text-sm text-ink-2">Fill in every field (or use the example) to see estimated proceeds, cash needed, monthly payments and three scenarios. We never fill in rates or prices for you.</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: "Estimated net proceeds", value: money(result.expected.netProceedsCents), tone: result.expected.netProceedsCents < 0 ? "text-danger" : "" },
                { label: "Cash needed at purchase", value: money(result.expected.cashNeededCents), tone: "" },
                { label: result.expected.gapCents > 0 ? "Estimated shortfall" : "Estimated cushion", value: money(Math.abs(result.expected.gapCents)), tone: result.expected.gapCents > 0 ? "text-danger" : "text-success" },
              ].map((k) => (
                <div key={k.label} className="rounded-[22px] bg-paper p-5 ring-1 ring-line">
                  <p className="type-eyebrow text-ink-3">{k.label}</p>
                  <p className={cn("tabular mt-2 text-2xl", k.tone)}>{k.value}</p>
                </div>
              ))}
            </div>
            <div className="rounded-[24px] bg-paper p-6 ring-1 ring-line">
              <p className="type-eyebrow text-ink-3">Estimated monthly housing payment</p>
              <p className="tabular mt-2 text-3xl">{money(result.expected.monthlyHousingCents)}<span className="text-base text-ink-2">/month</span></p>
              <p className="mt-2 text-sm text-ink-2">
                Principal & interest {money(result.expected.monthlyPrincipalInterestCents)} + taxes {money(result.expected.monthlyTaxCents)} + insurance {money(result.expected.monthlyInsuranceCents)} + HOA {money(result.expected.monthlyHoaCents)}. Excludes mortgage insurance and utilities.
              </p>
            </div>

            {result.gaps.length > 0 && (
              <ul className="space-y-2 rounded-[24px] bg-warn-bg p-5 text-sm text-warn">
                {result.gaps.map((g) => <li key={g} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{g}</li>)}
              </ul>
            )}

            <div className="overflow-x-auto rounded-[24px] bg-paper ring-1 ring-line">
              <table className="w-full min-w-[520px] text-sm">
                <caption className="px-5 pt-5 text-left type-headline">Three scenarios</caption>
                <thead className="text-[0.75rem] uppercase tracking-[0.1em] text-ink-3">
                  <tr><th scope="col" className="px-5 py-3 text-left font-medium">Estimate</th>{result.scenarios.map((s) => <th key={s.key} scope="col" className="px-5 py-3 text-right font-medium">{s.label}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {([
                    ["Sale price", "salePriceCents"],
                    ["Net proceeds", "netProceedsCents"],
                    ["Cash needed", "cashNeededCents"],
                    ["Shortfall (+) / cushion (−)", "gapCents"],
                    ["Monthly P&I", "monthlyPrincipalInterestCents"],
                    ["Monthly housing", "monthlyHousingCents"],
                    ...(form.sellFirst === "true" ? [] : [["Bridge financing", "bridgeNeededCents"], ["Carrying + bridge interest", "overlapCarryingCents"]]),
                  ] as [string, keyof typeof result.expected][]).map(([label, key]) => (
                    <tr key={key}><th scope="row" className="px-5 py-2.5 text-left font-normal text-ink-2">{label}</th>{result.scenarios.map((s) => <td key={s.key} className="tabular px-5 py-2.5 text-right">{money(s.result[key])}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              <ul className="space-y-1 px-5 pb-5 text-[0.75rem] text-ink-3">{result.scenarios.map((s) => <li key={s.key}><strong>{s.label}:</strong> {s.note}</li>)}</ul>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div className="rounded-[24px] bg-paper p-5 ring-1 ring-line">
                <p className="type-headline">Sell first vs. buy first</p>
                <dl className="mt-4 space-y-2 text-sm">
                  {[["Sell first", result.sellVsBuy.sellFirst], ["Buy first", result.sellVsBuy.buyFirst]].map(([label, b]) => {
                    const r = b as typeof result.expected;
                    return (
                      <div key={label as string} className="rounded-2xl bg-fill p-3">
                        <dt className="font-medium">{label as string}</dt>
                        <dd className="mt-1 text-ink-2">Cash available at purchase {money(r.cashAvailableCents)} · bridge {money(r.bridgeNeededCents)} · transition costs {money(r.transitionCostsCents)}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
              <div className="rounded-[24px] bg-paper p-5 ring-1 ring-line">
                <p className="type-headline">Rate sensitivity</p>
                <div className="mt-3 h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={result.rateSensitivity.map((r) => ({ rate: `${(r.rateBps / 100).toFixed(2)}%`, payment: Math.round(r.monthlyPrincipalInterestCents / 100) }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                      <XAxis dataKey="rate" tick={{ fontSize: 11, fill: "var(--ink-3)" }} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--ink-3)" }} width={48} />
                      <Tooltip formatter={(v) => [`$${Number(v).toLocaleString("en-US")}`, "P&I / month"]} contentStyle={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 12 }} />
                      <Bar dataKey="payment" fill="var(--gold)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div className="rounded-[24px] bg-paper p-5 ring-1 ring-line">
                <p className="type-headline">Purchase price options</p>
                <ul className="mt-3 divide-y divide-line text-sm">{result.priceScenarios.map((p) => <li key={p.label} className="flex justify-between py-2"><span>{p.label} · {money(p.newPriceCents)}</span><span className="tabular">{money(p.result.monthlyHousingCents)}/mo · {p.result.gapCents > 0 ? `short ${money(p.result.gapCents)}` : `+${money(-p.result.gapCents)}`}</span></li>)}</ul>
              </div>
              <div className="rounded-[24px] bg-paper p-5 ring-1 ring-line">
                <p className="type-headline">Down payment options</p>
                <ul className="mt-3 divide-y divide-line text-sm">{result.downPaymentScenarios.map((d) => <li key={d.downPaymentBps} className="flex justify-between py-2"><span>{(d.downPaymentBps / 100).toFixed(0)}% down</span><span className="tabular">{money(d.result.monthlyHousingCents)}/mo · cash {money(d.result.cashNeededCents)}</span></li>)}</ul>
              </div>
            </div>

            <div className="rounded-[24px] bg-paper p-6 ring-1 ring-line">
              <p className="type-headline">Typical timeline</p>
              <ol className="mt-4 space-y-3 border-l border-line-strong pl-5">
                {result.timeline.map((s) => <li key={s.label} className="relative text-sm"><span className="absolute -left-[27px] top-1 size-2.5 rounded-full bg-gold" aria-hidden /><span className="font-medium">Month {s.month}: {s.label}</span>{s.detail && <span className="block text-ink-2">{s.detail}</span>}</li>)}
              </ol>
            </div>

            <div className="rounded-[24px] bg-paper p-6 ring-1 ring-line">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="type-headline">In plain English</p>
                <Button type="button" variant="outline" size="sm" onClick={() => void explain()} disabled={explaining}><Sparkles /> {explaining ? "Writing…" : "Explain with AI"}</Button>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-ink-2">{explanation?.text ?? result.summary}</p>
              <p className="mt-2 text-[0.75rem] text-ink-3">{explanation ? (explanation.engine === "rules" ? "Local AI is unavailable or its draft used numbers that weren't in your calculation, so this is the built-in summary." : `Written by a local AI model (${explanation.engine}) from your calculation; every dollar figure was checked against it.`) : "Built-in summary of your calculation."}</p>
              <details className="mt-4 text-[0.8125rem] text-ink-2">
                <summary className="cursor-pointer font-medium text-ink">How these numbers are calculated</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>Net proceeds = sale price − (sale price × selling cost %) − repairs − mortgage payoff.</li>
                  <li>Cash needed = down payment + buyer closing costs + moving.</li>
                  <li>Monthly principal & interest = loan × r ÷ (1 − (1 + r)<sup>−n</sup>), where r = annual rate ÷ 12 and n = years × 12.</li>
                  <li>Housing payment adds taxes ÷ 12, insurance ÷ 12 and HOA. Mortgage insurance is not included.</li>
                  <li>Buying first: bridge financing = cash needed − savings; carrying cost = overlap months × current housing cost + bridge interest.</li>
                  <li>All money is computed in whole cents; amounts are rounded to the nearest dollar for display.</li>
                </ul>
              </details>
            </div>

            <p className="rounded-2xl bg-fill p-4 text-[0.8125rem] text-ink-2">
              Estimates from your assumptions only — not a mortgage approval, appraisal, or legal, tax or financial advice. Confirm rates and costs with your lender, attorney and agent.
            </p>

            <div className="flex flex-wrap gap-2 print:hidden">
              <Button type="button" variant="outline" onClick={() => inputs && download("surette-dual-move.csv", toCsv(inputs, result), "text/csv")}><Download /> CSV</Button>
              <Button type="button" variant="outline" onClick={() => window.print()}><Printer /> Print / save as PDF</Button>
              <Button type="button" variant="outline" onClick={() => inputs && download("agent-briefing.txt", agentBriefing(inputs, result), "text/plain")}><Download /> Agent briefing</Button>
              <Button type="button" onClick={() => setShare((s) => ({ ...s, open: !s.open, name: s.name || viewer?.fullName || "", email: s.email || viewer?.email || "" }))}><Send /> Send to an agent</Button>
            </div>

            {viewer?.role === "client" && (
              <form onSubmit={saveScenario} className="flex flex-wrap items-end gap-2 print:hidden">
                <Field label="Save this scenario" htmlFor="dm-save" className="flex-1">
                  <Input id="dm-save" value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="e.g. Sell first, spring move" maxLength={80} />
                </Field>
                <Button type="submit" variant="outline"><Save /> Save</Button>
                {saved && <p className="w-full text-sm text-ink-2" role="status">{saved}</p>}
              </form>
            )}

            {share.open && (
              <form onSubmit={sendToAgent} className="space-y-3 rounded-[24px] bg-paper p-6 ring-1 ring-line print:hidden" data-sa-form="dual-move-share">
                {share.state === "done" ? (
                  <p className="text-sm text-success" role="status">Sent. An agent will review your plan and follow up.</p>
                ) : (
                  <>
                    <p className="type-headline">Send your plan to an agent</p>
                    <p className="text-sm text-ink-2">We&rsquo;ll send the briefing above (your assumptions and results) with your contact details.</p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label="Name" htmlFor="sh-n" error={share.errors.contactName}><Input id="sh-n" value={share.name} onChange={(e) => setShare((s) => ({ ...s, name: e.target.value }))} autoComplete="name" /></Field>
                      <Field label="Email" htmlFor="sh-e" error={share.errors.contactEmail}><Input id="sh-e" type="email" value={share.email} onChange={(e) => setShare((s) => ({ ...s, email: e.target.value }))} autoComplete="email" /></Field>
                      <Field label="Phone" htmlFor="sh-p" error={share.errors.contactPhone}><Input id="sh-p" type="tel" value={share.phone} onChange={(e) => setShare((s) => ({ ...s, phone: e.target.value }))} autoComplete="tel" /></Field>
                    </div>
                    <Field label="Note (optional)" htmlFor="sh-m"><Textarea id="sh-m" value={share.message} onChange={(e) => setShare((s) => ({ ...s, message: e.target.value }))} className="min-h-16" /></Field>
                    <label className="flex items-start gap-2.5 text-[0.8125rem] text-ink-2">
                      <input type="checkbox" checked={share.consent} onChange={(e) => setShare((s) => ({ ...s, consent: e.target.checked }))} className="mt-0.5 accent-[var(--gold)]" />
                      <span>{CONTACT_CONSENT_TEXT}</span>
                    </label>
                    {share.errors.consentContact && <p className="text-[0.8125rem] text-danger">{share.errors.consentContact}</p>}
                    {share.error && <p className="text-sm text-danger" role="alert">{share.error}</p>}
                    <Button type="submit" disabled={share.state === "sending"}>{share.state === "sending" ? "Sending…" : "Send plan"}</Button>
                  </>
                )}
              </form>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
