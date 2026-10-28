"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/client-api";
import { track } from "@/lib/analytics-client";
import { CONTACT_CONSENT_TEXT } from "@/lib/privacy";
import { useSaved } from "./saved-context";

/** Contact form → creates a lead with recorded consent. Analytics records only that it was started/submitted. */
export function ContactForm({ propertyId }: { propertyId?: string }) {
  const { viewer } = useSaved();
  const [f, setF] = useState({ name: "", email: "", phone: "", message: "", website: "" });
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prefill from the session once
    if (viewer) setF((x) => ({ ...x, name: x.name || viewer.fullName, email: x.email || viewer.email }));
  }, [viewer]);
  useEffect(() => track("contact_page_view"), []);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    setErrors({});
    setError("");
    try {
      await api("/api/leads", { method: "POST", body: { source: "contact_form", contactName: f.name, contactEmail: f.email || null, contactPhone: f.phone || null, message: f.message || null, propertyId: propertyId ?? null, consentContact: consent || undefined, website: f.website } });
      track("contact_submit", { source: "contact_form" });
      setState("done");
    } catch (err) {
      setState("idle");
      if (err instanceof ApiClientError) {
        setErrors(err.fields);
        setError(err.message);
      } else setError("Something went wrong. Please call the office.");
    }
  }

  if (state === "done") {
    return (
      <div className="rounded-[28px] bg-paper p-8 ring-1 ring-line" role="status">
        <CheckCircle2 className="size-8 text-success" aria-hidden />
        <p className="type-title mt-4">Thank you</p>
        <p className="mt-2 text-ink-2">Your message reached the Surette team. We usually reply within one business day.</p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4 rounded-[28px] bg-paper p-6 ring-1 ring-line sm:p-8" data-sa-form="contact" noValidate>
      <Field label="Name" htmlFor="c-name" error={errors.contactName}><Input id="c-name" value={f.name} onChange={set("name")} autoComplete="name" required /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" htmlFor="c-email" error={errors.contactEmail}><Input id="c-email" type="email" value={f.email} onChange={set("email")} autoComplete="email" /></Field>
        <Field label="Phone" htmlFor="c-phone" error={errors.contactPhone}><Input id="c-phone" type="tel" value={f.phone} onChange={set("phone")} autoComplete="tel" /></Field>
      </div>
      <Field label="How can we help?" htmlFor="c-message" error={errors.message}><Textarea id="c-message" value={f.message} onChange={set("message")} rows={5} maxLength={4000} /></Field>
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label htmlFor="c-website">Website</label><input id="c-website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} /></div>
      <label className="flex items-start gap-2.5 text-[0.8125rem] text-ink-2">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-[var(--brand)]" />
        <span>{CONTACT_CONSENT_TEXT}</span>
      </label>
      {errors.consentContact && <p className="text-[0.8125rem] text-danger">{errors.consentContact}</p>}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send message"}</Button>
    </form>
  );
}
