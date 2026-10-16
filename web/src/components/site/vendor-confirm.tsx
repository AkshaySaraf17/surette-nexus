"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/client-api";

/** Landing page for the signed link in dispatch emails: the contractor confirms receipt (and an ETA). */
export function VendorConfirm() {
  const params = useSearchParams();
  const ticket = params.get("ticket") ?? "";
  const vendor = params.get("vendor") ?? "";
  const sig = params.get("sig") ?? "";
  const [eta, setEta] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");
  const [at, setAt] = useState("");

  if (!ticket || !vendor || !sig) {
    return <p className="text-ink-2">This link is incomplete. Please use the link from your dispatch email.</p>;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    setError("");
    try {
      const res = await api<{ acknowledgedAt: string }>("/api/vendor-portal/acknowledge", { method: "POST", body: { ticket, vendor, sig, eta: eta || undefined } });
      setAt(res.acknowledgedAt);
      setState("done");
    } catch (err) {
      setState("idle");
      setError(err instanceof ApiClientError ? err.message : "Something went wrong.");
    }
  }

  if (state === "done") {
    return (
      <div className="rounded-[28px] bg-paper p-8 ring-1 ring-line" role="status">
        <CheckCircle2 className="size-8 text-success" aria-hidden />
        <p className="type-headline mt-4">Thank you — ticket {ticket} is confirmed.</p>
        <p className="mt-2 text-ink-2">Confirmed {new Date(at).toLocaleString("en-US")}. Please contact the tenant to arrange access.</p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-5 rounded-[28px] bg-paper p-8 ring-1 ring-line">
      <p className="text-ink-2">Ticket <strong className="text-ink">{ticket}</strong></p>
      <Field label="Estimated arrival (optional)" htmlFor="v-eta" hint="e.g. “Today by 4pm” or “Tomorrow morning”.">
        <Input id="v-eta" value={eta} onChange={(e) => setEta(e.target.value)} maxLength={200} />
      </Field>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={state === "sending"}>{state === "sending" ? "Confirming…" : "Confirm receipt"}</Button>
    </form>
  );
}
