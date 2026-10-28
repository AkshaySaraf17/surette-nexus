"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CalendarCheck, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { CONTACT_CONSENT_TEXT } from "@/lib/privacy";
import { useSaved } from "./saved-context";
import { track } from "@/lib/analytics-client";

const label = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/** "Request a private showing": real open slots from /api/showings/slots, then POST /api/showings. */
export function ShowingRequest({ propertyId, title }: { propertyId: string; title: string }) {
  const { viewer } = useSaved();
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<{ startsAt: string }[] | null>(null);
  const [slot, setSlot] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");

  useEffect(() => {
    if (!open) return;
    track("showing_request_start", { property_id: propertyId });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prefill from the session when the dialog opens
    setName((n) => n || viewer?.fullName || "");
    setEmail((e) => e || viewer?.email || "");
    if (slots) return;
    api<{ slots: { startsAt: string }[] }>(`/api/showings/slots?propertyId=${propertyId}`)
      .then(({ slots }) => {
        setSlots(slots);
        setSlot(slots[0]?.startsAt ?? "");
      })
      .catch(() => setSlots([]));
  }, [open, propertyId, slots, viewer]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    setErrors({});
    setMessage("");
    try {
      await api("/api/showings", {
        method: "POST",
        body: { propertyId, contactName: name, contactEmail: email, contactPhone: phone || null, startsAt: slot, notes: notes || null, source: "website", consentContact: consent || undefined },
      });
      setState("done");
      track("showing_request_submit", { property_id: propertyId, source: "website" });
    } catch (error) {
      setState("idle");
      if (error instanceof ApiClientError) {
        setErrors(error.fields);
        setMessage(error.message);
      } else setMessage("Something went wrong. Please try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="w-full">
          <CalendarClock /> Request a private showing
        </Button>
      </DialogTrigger>
      <DialogContent>
        {state === "done" ? (
          <div className="py-6 text-center">
            <CalendarCheck className="mx-auto size-10 text-success" aria-hidden />
            <DialogTitle className="mt-4 pr-0">Request received</DialogTitle>
            <DialogDescription>
              We&rsquo;ve asked for {label(slot)}. Your agent will confirm by email — usually within a few hours.
            </DialogDescription>
          </div>
        ) : (
          <form onSubmit={submit}>
            <DialogTitle>Private showing</DialogTitle>
            <DialogDescription>{title}. Choose a time; your agent confirms personally.</DialogDescription>
            <fieldset className="mt-6">
              <legend className="mb-2 text-[0.8125rem] font-medium text-ink-2">Available times (Eastern)</legend>
              {slots === null ? (
                <p className="text-sm text-ink-3">Finding open times…</p>
              ) : slots.length === 0 ? (
                <p className="text-sm text-ink-2">No open times in the next three weeks. Ask the AI assistant and we&rsquo;ll arrange one.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {slots.map((s) => (
                    <label key={s.startsAt} className={cn("pressable cursor-pointer rounded-xl border px-3 py-2.5 text-center text-sm", slot === s.startsAt ? "border-ink bg-ink text-paper" : "border-line-strong hover:bg-fill")}>
                      <input type="radio" name="slot" value={s.startsAt} checked={slot === s.startsAt} onChange={() => setSlot(s.startsAt)} className="sr-only" />
                      {label(s.startsAt)}
                    </label>
                  ))}
                </div>
              )}
              {errors.startsAt && <p className="mt-2 text-[0.8125rem] text-danger">{errors.startsAt}</p>}
            </fieldset>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="sr-name" error={errors.contactName}>
                <Input id="sr-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required aria-invalid={Boolean(errors.contactName)} />
              </Field>
              <Field label="Email" htmlFor="sr-email" error={errors.contactEmail}>
                <Input id="sr-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required aria-invalid={Boolean(errors.contactEmail)} />
              </Field>
              <Field label="Mobile (optional)" htmlFor="sr-phone" error={errors.contactPhone} className="sm:col-span-2">
                <Input id="sr-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" aria-invalid={Boolean(errors.contactPhone)} />
              </Field>
              <Field label="Anything we should know? (optional)" htmlFor="sr-notes" className="sm:col-span-2">
                <Textarea id="sr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} className="min-h-20" />
              </Field>
            </div>
            <label className="mt-5 flex items-start gap-2.5 text-[0.8125rem] text-ink-2">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-[var(--brand)]" />
              <span>{CONTACT_CONSENT_TEXT}</span>
            </label>
            {errors.consentContact && <p className="mt-1 text-[0.8125rem] text-danger">{errors.consentContact}</p>}
            {message && <p className="mt-4 text-sm text-danger" role="alert">{message}</p>}
            <Button type="submit" size="lg" className="mt-6 w-full" disabled={state === "sending" || !slot}>
              {state === "sending" ? "Sending…" : "Request this time"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
