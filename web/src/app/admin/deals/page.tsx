"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type DragEvent, type FormEvent } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { useStaff } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiClientError } from "@/lib/client-api";
import { DEAL_STAGES, STAGE_LABEL, type DealStage } from "@/lib/deal-rules";
import { dollarsToCents, formatPrice } from "@/lib/money";
import type { ListingCard } from "@/lib/types";
import { useLiveEvents } from "@/lib/use-live";
import { cn } from "@/lib/utils";

interface Deal {
  id: string;
  title: string;
  side: string;
  stage: DealStage;
  clientName: string;
  property: { id: string; title: string | null } | null;
  agent: { id: string; name: string | null } | null;
  priceCents: number | null;
  commissionCents: number | null;
  closingDate: string | null;
  openTasks: number;
  overdueItems: number;
  nextDue: { label: string | null; dueOn: string; urgency: string } | null;
}

const BOARD: DealStage[] = ["prospect", "showing", "offer", "under_contract", "inspection", "appraisal", "clear_to_close", "closed"];

function DealsBoard() {
  const viewer = useStaff();
  const router = useRouter();
  const params = useSearchParams();
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [q, setQ] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(params.get("new") === "1");
  const [listings, setListings] = useState<ListingCard[]>([]);
  const [staff, setStaff] = useState<{ id: string; fullName: string }[]>([]);
  const [form, setForm] = useState({ title: "", side: "buyer", clientName: "", clientEmail: "", propertyId: "", agentId: "", price: "", commission: "2.5", contractDate: "", closingDate: "", notes: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => setDeals((await api<{ deals: Deal[] }>("/api/deals")).deals), []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
    api<{ listings: ListingCard[] }>("/api/properties?drafts=1&limit=200").then((r) => setListings(r.listings));
    api<{ staff: { id: string; fullName: string }[] }>("/api/team/staff").then((r) => setStaff(r.staff));
  }, [load]);
  useLiveEvents(() => void load(), (e) => e.table.startsWith("transaction"));

  async function move(id: string, stage: DealStage) {
    const deal = deals?.find((d) => d.id === id);
    if (!deal || deal.stage === stage) return;
    setError("");
    setDeals((all) => all?.map((d) => (d.id === id ? { ...d, stage } : d)) ?? null);
    try {
      await api(`/api/deals/${id}`, { method: "PATCH", body: { stage } });
    } catch (e) {
      setError(e instanceof ApiClientError ? `${deal.title}: ${e.message} ${Object.values(e.fields).join(" ")}` : "Couldn't move the deal.");
      void load();
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    const priceCents = form.price.trim() ? dollarsToCents(form.price) : null;
    const bps = form.commission.trim() ? Math.round(Number(form.commission) * 100) : null;
    if (form.price.trim() && priceCents === null) return setErrors({ priceCents: "Enter a dollar amount." });
    try {
      const r = await api<{ id: string }>("/api/deals", {
        method: "POST",
        body: {
          title: form.title || `${form.clientName}${form.propertyId ? ` — ${listings.find((l) => l.id === form.propertyId)?.title ?? ""}` : ""}`,
          side: form.side,
          stage: "prospect",
          clientName: form.clientName,
          clientEmail: form.clientEmail || null,
          propertyId: form.propertyId || null,
          agentId: form.agentId || null,
          priceCents,
          commissionBps: bps !== null && Number.isFinite(bps) ? bps : null,
          contractDate: form.contractDate || null,
          closingDate: form.closingDate || null,
          notes: form.notes || null,
        },
      });
      router.push(`/admin/deals/${r.id}`);
    } catch (err) {
      if (err instanceof ApiClientError) setErrors({ ...err.fields, form: err.message });
    }
  }

  const visible = (deals ?? []).filter((d) => !q || `${d.title} ${d.clientName} ${d.property?.title ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const lost = visible.filter((d) => d.stage === "lost");

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="type-title">Deals</h1>
          <p className="mt-1 text-ink-2">{viewer.role === "admin" ? "Every deal for the team." : "Your deals."} Drag a card to change its stage — key dates are checked first.</p>
        </div>
        <div className="flex gap-2">
          <label htmlFor="deal-q" className="sr-only">Search deals</label>
          <Input id="deal-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search deals" className="h-10 w-56" />
          <Button onClick={() => setCreating(true)}><Plus /> New deal</Button>
        </div>
      </div>
      {error && <p className="mt-4 flex items-center gap-2 rounded-2xl bg-danger-bg p-3 text-sm text-danger" role="alert"><AlertTriangle className="size-4" /> {error}</p>}

      {deals === null ? <Skeleton className="mt-6 h-96" /> : (
        <div className="no-scrollbar relative mt-6 flex gap-4 overflow-x-auto pb-4">
          {BOARD.map((stage) => {
            const column = visible.filter((d) => d.stage === stage);
            return (
              <section
                key={stage}
                aria-label={STAGE_LABEL[stage]}
                onDragOver={(e: DragEvent) => e.preventDefault()}
                onDrop={(e: DragEvent) => {
                  e.preventDefault();
                  if (dragId) void move(dragId, stage);
                  setDragId(null);
                }}
                className={cn("w-72 shrink-0 rounded-[22px] bg-fill/60 p-3", dragId && "outline-2 outline-dashed outline-line-strong")}
              >
                <h2 className="flex items-center justify-between px-1 text-sm font-medium">{STAGE_LABEL[stage]}<span className="text-ink-3">{column.length}</span></h2>
                <p className="px-1 text-[0.75rem] text-ink-3">{formatPrice(column.reduce((a, d) => a + (d.priceCents ?? 0), 0))}</p>
                <ul className="mt-3 space-y-2">
                  {column.map((d) => (
                    <li key={d.id} draggable onDragStart={() => setDragId(d.id)} onDragEnd={() => setDragId(null)} className="cursor-grab rounded-2xl bg-paper p-3 shadow-sm ring-1 ring-line active:cursor-grabbing">
                      <Link href={`/admin/deals/${d.id}`} className="block">
                        <p className="text-sm font-medium leading-snug hover:underline">{d.title}</p>
                        <p className="mt-0.5 text-[0.75rem] text-ink-2">{d.side} · {d.agent?.name ?? "unassigned"}{d.priceCents ? ` · ${formatPrice(d.priceCents)}` : ""}</p>
                        {d.nextDue && <p className={cn("mt-2 text-[0.75rem]", d.nextDue.urgency === "overdue" ? "text-danger" : d.nextDue.urgency === "due_soon" ? "text-warn" : "text-ink-3")}>Next: {d.nextDue.label} · {d.nextDue.dueOn}</p>}
                        {d.overdueItems > 0 && <p className="mt-1 text-[0.75rem] font-medium text-danger">{d.overdueItems} overdue</p>}
                      </Link>
                      <label className="sr-only" htmlFor={`stage-${d.id}`}>Move {d.title}</label>
                      <Select id={`stage-${d.id}`} value={d.stage} onChange={(e) => void move(d.id, e.target.value as DealStage)} className="mt-2 h-8 text-[0.75rem]">{DEAL_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</Select>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {lost.length > 0 && (
        <details className="mt-4 text-sm"><summary className="cursor-pointer text-ink-2">Lost ({lost.length})</summary><ul className="mt-2 space-y-1">{lost.map((d) => <li key={d.id}><Link href={`/admin/deals/${d.id}`} className="underline">{d.title}</Link></li>)}</ul></details>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="w-[min(640px,calc(100vw-2rem))]">
          <form onSubmit={create} className="space-y-4" noValidate>
            <DialogTitle>New deal</DialogTitle>
            <DialogDescription>A checklist with milestones and tasks is created from the template for this side. Dates fill in once you add the contract and closing dates.</DialogDescription>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Client name" htmlFor="d-client" error={errors.clientName}><Input id="d-client" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} /></Field>
              <Field label="Client email (optional)" htmlFor="d-email" error={errors.clientEmail}><Input id="d-email" type="email" value={form.clientEmail} onChange={(e) => setForm({ ...form, clientEmail: e.target.value })} /></Field>
              <Field label="Side" htmlFor="d-side"><Select id="d-side" value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}><option value="buyer">Buyer</option><option value="seller">Seller</option><option value="dual">Dual agency</option><option value="lease">Lease</option></Select></Field>
              <Field label="Property (optional)" htmlFor="d-prop"><Select id="d-prop" value={form.propertyId} onChange={(e) => setForm({ ...form, propertyId: e.target.value })}><option value="">—</option>{listings.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</Select></Field>
              <Field label="Price ($)" htmlFor="d-price" error={errors.priceCents}><Input id="d-price" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
              <Field label="Commission (%)" htmlFor="d-comm" error={errors.commissionBps}><Input id="d-comm" inputMode="decimal" value={form.commission} onChange={(e) => setForm({ ...form, commission: e.target.value })} /></Field>
              <Field label="Contract date" htmlFor="d-contract" error={errors.contractDate}><Input id="d-contract" type="date" value={form.contractDate} onChange={(e) => setForm({ ...form, contractDate: e.target.value })} /></Field>
              <Field label="Closing date" htmlFor="d-closing" error={errors.closingDate}><Input id="d-closing" type="date" value={form.closingDate} onChange={(e) => setForm({ ...form, closingDate: e.target.value })} /></Field>
              {viewer.role === "admin" && <Field label="Agent" htmlFor="d-agent" className="sm:col-span-2"><Select id="d-agent" value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })}><option value="">Me</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</Select></Field>}
              <Field label="Deal name (optional)" htmlFor="d-title" error={errors.title} className="sm:col-span-2"><Input id="d-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Defaults to client — property" /></Field>
              <Field label="Notes" htmlFor="d-notes" className="sm:col-span-2"><Textarea id="d-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="min-h-16" /></Field>
            </div>
            {errors.form && <p className="text-sm text-danger" role="alert">{errors.form}</p>}
            <Button type="submit" className="w-full" disabled={!form.clientName.trim()}>Create deal</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <DealsBoard />
    </Suspense>
  );
}
