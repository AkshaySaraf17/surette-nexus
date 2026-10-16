"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiClientError } from "@/lib/client-api";
import { dollarsToCents, formatCents } from "@/lib/money";
import type { ListingCard, UtilityBill } from "@/lib/types";

const KINDS = [
  ["water", "Water"],
  ["electric", "Electric"],
  ["gas", "Gas"],
  ["sewer", "Sewer"],
  ["heating_oil", "Heating oil"],
  ["internet", "Internet"],
] as const;
const UNITS: Record<string, string> = { gallons: "gal", cubic_feet: "cu ft", kwh: "kWh", therms: "therms", none: "" };

/**
 * Utility ledger (water / electric tracking). Amounts are typed in dollars and
 * converted to integer cents in the browser (a $410.67 bill is sent and stored as
 * 41067); totals are summed by PostgreSQL over BIGINT cents.
 */
export default function UtilitiesPage() {
  const [data, setData] = useState<{ bills: UtilityBill[]; totals: { utility: string; amountCents: number; unpaidCents: number }[] } | null>(null);
  const [properties, setProperties] = useState<ListingCard[]>([]);
  const [form, setForm] = useState({ propertyId: "", utility: "water", provider: "", periodStart: "", periodEnd: "", usageQuantity: "", usageUnit: "gallons", amount: "", dueOn: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setData(await api("/api/utilities"));
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
    api<{ listings: ListingCard[] }>("/api/properties?drafts=1&limit=200").then(({ listings }) => {
      setProperties(listings);
      setForm((f) => ({ ...f, propertyId: f.propertyId || listings[0]?.id || "" }));
    });
  }, [load]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setMessage("");
    const amountCents = dollarsToCents(form.amount);
    if (amountCents === null || amountCents === 0) {
      setErrors({ amountCents: "Enter the bill amount, e.g. 410.67." });
      return;
    }
    try {
      await api("/api/utilities", {
        method: "POST",
        body: {
          propertyId: form.propertyId,
          utility: form.utility,
          provider: form.provider,
          periodStart: form.periodStart,
          periodEnd: form.periodEnd,
          usageQuantity: form.usageQuantity ? Number(form.usageQuantity) : null,
          usageUnit: form.usageQuantity ? form.usageUnit : null,
          amountCents,
          dueOn: form.dueOn || null,
        },
      });
      setMessage(`Recorded ${formatCents(amountCents)} (${amountCents} cents).`);
      setForm((f) => ({ ...f, provider: "", amount: "", usageQuantity: "", periodStart: "", periodEnd: "", dueOn: "" }));
      await load();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrors(err.fields);
        setMessage(err.message);
      }
    }
  }

  async function togglePaid(bill: UtilityBill) {
    await api(`/api/utilities/${bill.id}`, { method: "PATCH", body: { paidOn: bill.paidOn ? null : new Date().toISOString().slice(0, 10) } });
    await load();
  }

  return (
    <div className="grid gap-10 lg:grid-cols-12">
      <div className="lg:col-span-8">
        <h1 className="type-title">Utilities</h1>
        <p className="mt-1 text-ink-2">Water, electric and other bills per property. Exact to the cent.</p>
        {data === null ? (
          <Skeleton className="mt-8 h-80" />
        ) : (
          <>
            <ul className="mt-8 grid gap-3 sm:grid-cols-3">
              {data.totals.map((t) => (
                <li key={t.utility} className="rounded-[20px] bg-paper p-5 ring-1 ring-line">
                  <p className="type-eyebrow text-ink-3">{KINDS.find(([k]) => k === t.utility)?.[1] ?? t.utility}</p>
                  <p className="tabular mt-2 text-xl">{formatCents(t.amountCents)}</p>
                  <p className="tabular text-[0.8125rem] text-ink-2">{t.unpaidCents ? `${formatCents(t.unpaidCents)} unpaid` : "All paid"}</p>
                </li>
              ))}
            </ul>
            <div className="mt-6 overflow-x-auto rounded-[24px] bg-paper ring-1 ring-line">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="border-b border-line text-[0.75rem] uppercase tracking-[0.1em] text-ink-3">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Property</th>
                    <th scope="col" className="px-4 py-3 font-medium">Utility</th>
                    <th scope="col" className="px-4 py-3 font-medium">Period</th>
                    <th scope="col" className="px-4 py-3 font-medium">Usage</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
                    <th scope="col" className="px-4 py-3 font-medium">Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.bills.map((b) => (
                    <tr key={b.id}>
                      <td className="px-4 py-3">{b.propertyTitle}</td>
                      <td className="px-4 py-3">{KINDS.find(([k]) => k === b.utility)?.[1]} <span className="text-ink-3">· {b.provider}</span></td>
                      <td className="tabular px-4 py-3 text-ink-2">{b.periodStart} → {b.periodEnd}</td>
                      <td className="tabular px-4 py-3 text-ink-2">{b.usageQuantity !== null ? `${b.usageQuantity.toLocaleString("en-US")} ${UNITS[b.usageUnit ?? "none"]}` : "—"}</td>
                      <td className="tabular px-4 py-3 text-right font-medium">{formatCents(b.amountCents)}</td>
                      <td className="px-4 py-3">
                        <button type="button" onClick={() => void togglePaid(b)} className="pressable rounded-full border border-line-strong px-2.5 py-1 text-[0.75rem]">
                          {b.paidOn ? `Paid ${b.paidOn}` : "Mark paid"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      <form onSubmit={submit} className="space-y-4 self-start rounded-[28px] bg-paper p-6 ring-1 ring-line lg:col-span-4" noValidate>
        <h2 className="type-headline">Record a bill</h2>
        <Field label="Property" htmlFor="u-prop" error={errors.propertyId}>
          <Select id="u-prop" value={form.propertyId} onChange={set("propertyId")}>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Utility" htmlFor="u-kind">
            <Select id="u-kind" value={form.utility} onChange={set("utility")}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          </Field>
          <Field label="Provider" htmlFor="u-provider" error={errors.provider}>
            <Input id="u-provider" value={form.provider} onChange={set("provider")} placeholder="Kennebec Water District" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Period start" htmlFor="u-start" error={errors.periodStart}><Input id="u-start" type="date" value={form.periodStart} onChange={set("periodStart")} /></Field>
          <Field label="Period end" htmlFor="u-end" error={errors.periodEnd}><Input id="u-end" type="date" value={form.periodEnd} onChange={set("periodEnd")} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Usage" htmlFor="u-usage" error={errors.usageQuantity}><Input id="u-usage" inputMode="numeric" value={form.usageQuantity} onChange={set("usageQuantity")} /></Field>
          <Field label="Unit" htmlFor="u-unit">
            <Select id="u-unit" value={form.usageUnit} onChange={set("usageUnit")}>
              <option value="gallons">gallons</option><option value="cubic_feet">cubic feet</option><option value="kwh">kWh</option><option value="therms">therms</option><option value="none">—</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount ($)" htmlFor="u-amount" error={errors.amountCents} hint="Stored as integer cents."><Input id="u-amount" inputMode="decimal" value={form.amount} onChange={set("amount")} placeholder="410.67" /></Field>
          <Field label="Due" htmlFor="u-due" error={errors.dueOn}><Input id="u-due" type="date" value={form.dueOn} onChange={set("dueOn")} /></Field>
        </div>
        {message && <p className="text-sm text-ink-2" role="status">{message}</p>}
        <Button type="submit" className="w-full">Record bill</Button>
      </form>
    </div>
  );
}
