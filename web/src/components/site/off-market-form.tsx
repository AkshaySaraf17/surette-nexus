"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/client-api";
import { track } from "@/lib/analytics-client";
import { HOME_STYLES } from "@/lib/home-styles";
import { CONTACT_CONSENT_TEXT } from "@/lib/privacy";
import { cn } from "@/lib/utils";

/** Towns the team covers, offered as quick picks. */
export const OFF_MARKET_TOWNS = ["Waterville", "Winslow", "Oakland", "Fairfield", "Belgrade", "Sidney", "China", "Vassalboro", "Benton", "Clinton", "Augusta", "Skowhegan"];

const PRICES = [
  { label: "Any price", value: "" },
  { label: "Up to $250K", value: "25000000" },
  { label: "Up to $350K", value: "35000000" },
  { label: "Up to $500K", value: "50000000" },
  { label: "Up to $750K", value: "75000000" },
  { label: "Up to $1M", value: "100000000" },
  { label: "Over $1M", value: "over" },
];
const TIMEFRAMES = ["As soon as possible", "Within 3 months", "3 to 6 months", "6 to 12 months", "Just keeping an eye out"];

/**
 * Off-market alerts: a buyer describes the home they want before it's listed, and the team
 * reaches out when one comes up (from their network, before it hits the MLS). Creates a lead
 * with source "off_market" and the wish list in its preferences. `embedded` is the compact
 * version for /embed/off-market, placed on other sites such as the team's Lofty website.
 */
export function OffMarketForm({ embedded = false }: { embedded?: boolean }) {
  const [styles, setStyles] = useState<string[]>([]);
  const [towns, setTowns] = useState<string[]>([]);
  const [f, setF] = useState({ maxPrice: "", minBeds: "", timeframe: TIMEFRAMES[1], notes: "", name: "", email: "", phone: "", website: "" });
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const toggle = (list: string[], setList: (v: string[]) => void, value: string) => setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    setErrors({});
    setError("");
    const styleLabels = HOME_STYLES.filter((s) => styles.includes(s.slug)).map((s) => s.label);
    const price = PRICES.find((p) => p.value === f.maxPrice)?.label ?? "Any price";
    const summary = [
      styleLabels.length ? styleLabels.join(", ") : "Any style",
      towns.length ? `in ${towns.join(", ")}` : "anywhere in Central Maine",
      price,
      f.minBeds ? `${f.minBeds}+ beds` : null,
      f.timeframe,
    ].filter(Boolean).join(" · ");
    try {
      await api("/api/leads", {
        method: "POST",
        body: {
          source: "off_market",
          contactName: f.name,
          contactEmail: f.email || null,
          contactPhone: f.phone || null,
          message: `Off-market alert: ${summary}${f.notes.trim() ? `\n\n${f.notes.trim()}` : ""}`,
          preferences: {
            styles,
            towns,
            ...(f.maxPrice && f.maxPrice !== "over" ? { maxPriceCents: Number(f.maxPrice) } : {}),
            ...(f.maxPrice === "over" ? { minPriceCents: 100_000_000 } : {}),
            ...(f.minBeds ? { minBeds: Number(f.minBeds) } : {}),
            timeframe: f.timeframe,
            surface: embedded ? "embed" : "website",
          },
          consentContact: consent || undefined,
          website: f.website,
        },
      });
      track("contact_submit", { source: embedded ? "off_market_embed" : "off_market" });
      setState("done");
    } catch (err) {
      setState("idle");
      if (err instanceof ApiClientError) {
        setErrors(err.fields);
        setError(err.message);
      } else setError("Something went wrong. Please call the office at 207-873-5634.");
    }
  }

  if (state === "done") {
    return (
      <div className={cn("rounded-[28px] bg-paper p-8 ring-1 ring-line", embedded && "rounded-2xl p-6")} role="status">
        <CheckCircle2 className="size-8 text-success" aria-hidden />
        <p className="type-title mt-4">You&rsquo;re on the list</p>
        <p className="mt-2 text-ink-2">
          The Surette team will reach out when a home that fits comes up, often before it&rsquo;s listed. We usually say hello within one business day.
        </p>
      </div>
    );
  }

  const chip = (active: boolean) =>
    cn("pressable rounded-full px-3.5 py-1.5 text-sm ring-1 transition-colors", active ? "bg-ink text-paper ring-ink" : "bg-paper ring-line hover:ring-line-strong");

  return (
    <form onSubmit={submit} className={cn("space-y-6 rounded-[28px] bg-paper p-6 ring-1 ring-line sm:p-8", embedded && "rounded-2xl sm:p-6")} data-sa-form="off_market" noValidate>
      <fieldset>
        <legend className="text-sm font-medium">What kind of place? <span className="font-normal text-ink-3">(pick any)</span></legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {HOME_STYLES.map((s) => (
            <button key={s.slug} type="button" aria-pressed={styles.includes(s.slug)} onClick={() => toggle(styles, setStyles, s.slug)} className={chip(styles.includes(s.slug))}>
              {s.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium">Which towns? <span className="font-normal text-ink-3">(leave blank for anywhere nearby)</span></legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {OFF_MARKET_TOWNS.map((t) => (
            <button key={t} type="button" aria-pressed={towns.includes(t)} onClick={() => toggle(towns, setTowns, t)} className={chip(towns.includes(t))}>
              {t}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Budget" htmlFor="om-price">
          <Select id="om-price" value={f.maxPrice} onChange={set("maxPrice")}>
            {PRICES.map((p) => <option key={p.label} value={p.value}>{p.label}</option>)}
          </Select>
        </Field>
        <Field label="Bedrooms" htmlFor="om-beds">
          <Select id="om-beds" value={f.minBeds} onChange={set("minBeds")}>
            <option value="">Any</option>
            {[1, 2, 3, 4, 5].map((b) => <option key={b} value={b}>{b}+</option>)}
          </Select>
        </Field>
        <Field label="When are you moving?" htmlFor="om-time">
          <Select id="om-time" value={f.timeframe} onChange={set("timeframe")}>
            {TIMEFRAMES.map((t) => <option key={t}>{t}</option>)}
          </Select>
        </Field>
      </div>

      <Field label="Anything else? (frontage, acreage, a garage for the boat…)" htmlFor="om-notes" error={errors.message}>
        <Textarea id="om-notes" value={f.notes} onChange={set("notes")} rows={3} maxLength={3000} />
      </Field>

      <div className="space-y-4 border-t border-line pt-6">
        <Field label="Name" htmlFor="om-name" error={errors.contactName}><Input id="om-name" value={f.name} onChange={set("name")} autoComplete="name" required /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" htmlFor="om-email" error={errors.contactEmail}><Input id="om-email" type="email" value={f.email} onChange={set("email")} autoComplete="email" /></Field>
          <Field label="Phone (optional)" htmlFor="om-phone" error={errors.contactPhone}><Input id="om-phone" type="tel" value={f.phone} onChange={set("phone")} autoComplete="tel" /></Field>
        </div>
      </div>
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label htmlFor="om-website">Website</label><input id="om-website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} /></div>
      <label className="flex items-start gap-2.5 text-[0.8125rem] text-ink-2">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-[var(--brand)]" />
        <span>{CONTACT_CONSENT_TEXT}</span>
      </label>
      {errors.consentContact && <p className="text-[0.8125rem] text-danger">{errors.consentContact}</p>}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Get off-market alerts"}</Button>
      <p className="text-center text-[0.75rem] text-ink-3">Free, no obligation. One email or call when something fits, never a newsletter.</p>
    </form>
  );
}
