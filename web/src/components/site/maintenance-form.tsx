"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, Siren } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/client-api";

/**
 * Tenant maintenance intake widget. Posts to /api/maintenance, which validates and
 * forwards to the landlord-dispatcher (AI triage → insured vendor → work order).
 * Also embeddable on the client's existing site (see README → "Embedding").
 */
export function MaintenanceForm() {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ticketRef: string; trade: string; urgency: string; summary: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError("");
    try {
      setResult(await api("/api/maintenance", { method: "POST", body: { phone, message, website } }));
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrors(err.fields);
        setError(err.message);
      } else setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="rounded-[28px] bg-paper p-8 ring-1 ring-line" role="status">
        <CheckCircle2 className="size-8 text-success" aria-hidden />
        <h2 className="type-title mt-4">Request received</h2>
        <p className="mt-3 text-ink-2">Ticket <strong className="text-ink">{result.ticketRef}</strong> · {result.trade} · {result.urgency}</p>
        <p className="mt-3 text-ink-2">{result.summary}</p>
        {result.urgency === "Emergency" && (
          <p className="mt-6 flex gap-3 rounded-2xl bg-danger-bg p-4 text-sm text-danger"><Siren className="size-5 shrink-0" aria-hidden /> We&rsquo;ve flagged this as an emergency and a contractor is being dispatched. If anyone is in danger, call 911.</p>
        )}
        <Button variant="outline" className="mt-8" onClick={() => { setResult(null); setMessage(""); }}>Report another issue</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-[28px] bg-paper p-6 ring-1 ring-line sm:p-8" noValidate>
      <Field label="Mobile number on your lease" htmlFor="m-phone" error={errors.phone}>
        <Input id="m-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="(207) 555-0142" required aria-invalid={Boolean(errors.phone)} />
      </Field>
      <Field label="What's happening?" htmlFor="m-message" error={errors.message} hint="Where in the unit, when it started, and anything you've already tried.">
        <Textarea id="m-message" value={message} onChange={(e) => setMessage(e.target.value)} required maxLength={2000} rows={6} aria-invalid={Boolean(errors.message)} placeholder="The kitchen sink is leaking under the cabinet and the floor is wet…" />
      </Field>
      {/* Honeypot for bots — hidden from people and assistive tech. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="m-website">Website</label>
        <input id="m-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Sending…" : "Send maintenance request"}</Button>
      <p className="text-[0.8125rem] text-ink-3">For fire, gas smells or anyone in danger, leave the building and call 911 first.</p>
    </form>
  );
}
