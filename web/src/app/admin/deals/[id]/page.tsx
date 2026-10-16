"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, Check, Copy, Download, FileUp, Mail, Plus, Sparkles, Trash2 } from "lucide-react";
import { useStaff } from "@/components/admin/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiClientError } from "@/lib/client-api";
import { DEAL_STAGES, STAGE_LABEL, type DealStage } from "@/lib/deal-rules";
import { dollarsToCents, formatCents, formatPrice } from "@/lib/money";
import { useLiveEvents } from "@/lib/use-live";
import { cn } from "@/lib/utils";

interface Item { id: string; dueOn: string | null; urgency: string }
interface Milestone extends Item { label: string; done: boolean; rule: string | null; clientVisible: boolean }
interface Task extends Item { title: string; status: string; assignee: { id: string; name: string | null } | null }
interface Doc { id: string; label: string; fileName: string; mimeType: string; bytes: number; extractionStatus: string; extracted: { field: string; label: string; value: string; normalized: string | number; source: string }[]; createdAt: string }
interface Draft { id: string; to: string | null; subject: string; body: string; status: string; aiGenerated: boolean; createdAt: string; approvedAt: string | null }
interface Detail {
  deal: {
    id: string; title: string; side: string; stage: DealStage; clientName: string; clientEmail: string | null; property: { id: string; title: string | null; slug: string | null } | null;
    agent: { id: string; name: string | null } | null; priceCents: number | null; commissionBps: number | null; commissionCents: number | null; contractDate: string | null; closingDate: string | null; notes: string | null; lostReason: string | null; leadId: string | null;
  };
  summary: string;
  milestones: Milestone[];
  tasks: Task[];
  documents: Doc[];
  drafts: Draft[];
  activity: { action: string; data: Record<string, unknown>; actor: string | null; at: string }[];
}

const tone = (u: string) => (u === "overdue" ? "text-danger" : u === "due_soon" ? "text-warn" : "text-ink-3");
const centsToInput = (c: number | null) => (c ? `${Math.floor(c / 100)}${c % 100 ? `.${String(c % 100).padStart(2, "0")}` : ""}` : "");

export default function DealPage() {
  const { id } = useParams<{ id: string }>();
  const viewer = useStaff();
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [staff, setStaff] = useState<{ id: string; fullName: string }[]>([]);
  const [keys, setKeys] = useState({ price: "", commission: "", contractDate: "", closingDate: "", lostReason: "" });
  const [newItem, setNewItem] = useState({ kind: "task", title: "", dueOn: "" });
  const [upload, setUpload] = useState({ label: "", extract: true, busy: false, error: "" });
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Record<string, { subject: string; body: string; to: string }>>({});
  const [draftBusy, setDraftBusy] = useState(false);
  const [mailto, setMailto] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const data = await api<Detail>(`/api/deals/${id}`);
      setD(data);
      setKeys({ price: centsToInput(data.deal.priceCents), commission: data.deal.commissionBps !== null ? String(data.deal.commissionBps / 100) : "", contractDate: data.deal.contractDate ?? "", closingDate: data.deal.closingDate ?? "", lostReason: data.deal.lostReason ?? "" });
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load the deal.");
    }
  }, [id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
    api<{ staff: { id: string; fullName: string }[] }>("/api/team/staff").then((r) => setStaff(r.staff));
  }, [load]);
  useLiveEvents(() => void load(), (e) => e.transactionId === id);

  async function patchDeal(body: Record<string, unknown>) {
    setError("");
    try {
      await api(`/api/deals/${id}`, { method: "PATCH", body });
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? `${e.message} ${Object.values(e.fields).join(" ")}` : "Couldn't save.");
    }
  }
  async function saveKeys(e: FormEvent) {
    e.preventDefault();
    const priceCents = keys.price.trim() ? dollarsToCents(keys.price) : null;
    if (keys.price.trim() && priceCents === null) return setError("Enter the price as dollars, e.g. 1,850,000.");
    const bps = keys.commission.trim() ? Math.round(Number(keys.commission) * 100) : null;
    await patchDeal({ priceCents, commissionBps: bps, contractDate: keys.contractDate || null, closingDate: keys.closingDate || null });
  }
  async function item(body: Record<string, unknown>, method: "POST" | "PATCH" = "PATCH") {
    await api(`/api/deals/${id}/items`, { method, body });
    await load();
  }
  async function addItem(e: FormEvent) {
    e.preventDefault();
    if (!newItem.title.trim()) return;
    await item({ kind: newItem.kind, title: newItem.title, dueOn: newItem.dueOn || null }, "POST");
    setNewItem({ ...newItem, title: "", dueOn: "" });
  }
  async function uploadDoc(e: FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setUpload((u) => ({ ...u, error: "Choose a file." }));
    setUpload((u) => ({ ...u, busy: true, error: "" }));
    const body = new FormData();
    body.append("file", file);
    body.append("label", upload.label || file.name);
    body.append("extract", String(upload.extract));
    const res = await fetch(`/api/deals/${id}/documents`, { method: "POST", body });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setUpload((u) => ({ ...u, busy: false, error: err?.error?.message ?? "Upload failed." }));
      return;
    }
    if (fileRef.current) fileRef.current.value = "";
    setUpload({ label: "", extract: true, busy: false, error: "" });
    await load();
  }
  async function reviewDoc(doc: Doc, decision: "verified" | "rejected", apply: string[] = []) {
    await api(`/api/deals/${id}/documents/${doc.id}`, { method: "PATCH", body: { decision, apply } });
    await load();
  }
  async function generate(kind: string, itemId?: string, useAi = false) {
    setDraftBusy(true);
    try {
      await api(`/api/deals/${id}/drafts`, { method: "POST", body: { kind, itemId: itemId ?? null, useAi } });
      await load();
      document.getElementById("drafts")?.scrollIntoView({ behavior: "smooth" });
    } finally {
      setDraftBusy(false);
    }
  }
  async function draftAction(draft: Draft, action: "save" | "approve" | "mark_sent" | "discard") {
    const edit = editing[draft.id];
    try {
      const r = await api<{ status: string; mailto: string | null }>(`/api/drafts/${draft.id}`, { method: "PATCH", body: { action, ...(action === "save" && edit ? { subject: edit.subject, body: edit.body, to: edit.to || null } : {}) } });
      if (r.mailto) setMailto((m) => ({ ...m, [draft.id]: r.mailto! }));
      setEditing((x) => {
        const copy = { ...x };
        delete copy[draft.id];
        return copy;
      });
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't update the draft.");
    }
  }

  if (error && !d) return <p className="text-danger">{error}</p>;
  if (!d) return <Skeleton className="h-[700px] w-full rounded-[28px]" />;
  const deal = d.deal;

  return (
    <div className="space-y-6">
      <Link href="/admin/deals" className="text-sm text-ink-2 hover:text-ink">← Deals</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="type-title">{deal.title}</h1>
          <p className="mt-1 text-sm text-ink-2">
            {deal.side} side · client {deal.clientName}{deal.clientEmail ? ` (${deal.clientEmail})` : ""}
            {deal.property && <> · <Link href={`/listings/${deal.property.slug}`} target="_blank" className="underline">{deal.property.title}</Link></>}
            {deal.leadId && <> · <Link href={`/admin/leads?open=${deal.leadId}`} className="underline">lead</Link></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="deal-stage" className="text-sm text-ink-2">Stage</label>
          <Select id="deal-stage" value={deal.stage} onChange={(e) => (e.target.value === "lost" ? setKeys((k) => ({ ...k, lostReason: k.lostReason || " " })) : void patchDeal({ stage: e.target.value }))} className="h-10 w-48">
            {DEAL_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </Select>
        </div>
      </div>
      {keys.lostReason && deal.stage !== "lost" && (
        <form onSubmit={(e) => { e.preventDefault(); void patchDeal({ stage: "lost", lostReason: keys.lostReason.trim() }); }} className="flex flex-wrap items-end gap-2 rounded-2xl bg-warn-bg p-4">
          <Field label="Why was this deal lost?" htmlFor="lost-r" className="flex-1"><Input id="lost-r" value={keys.lostReason.trimStart()} onChange={(e) => setKeys({ ...keys, lostReason: e.target.value })} /></Field>
          <Button type="submit" size="sm" variant="danger">Mark lost</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setKeys({ ...keys, lostReason: "" })}>Cancel</Button>
        </form>
      )}
      {error && <p className="flex items-center gap-2 rounded-2xl bg-danger-bg p-3 text-sm text-danger" role="alert"><AlertTriangle className="size-4" /> {error}</p>}

      <p className="rounded-[22px] bg-paper p-5 text-sm leading-relaxed ring-1 ring-line"><span className="type-eyebrow mr-2 text-gold">Status</span>{d.summary}</p>

      <div className="grid gap-6 xl:grid-cols-3">
        <form onSubmit={saveKeys} className="space-y-3 rounded-[24px] bg-paper p-6 ring-1 ring-line">
          <h2 className="type-headline">Key terms</h2>
          <Field label="Price ($)" htmlFor="k-price"><Input id="k-price" inputMode="decimal" value={keys.price} onChange={(e) => setKeys({ ...keys, price: e.target.value })} /></Field>
          <Field label="Commission (%)" htmlFor="k-comm" hint={deal.commissionCents !== null ? `Est. gross commission ${formatCents(deal.commissionCents)}` : undefined}><Input id="k-comm" inputMode="decimal" value={keys.commission} onChange={(e) => setKeys({ ...keys, commission: e.target.value })} /></Field>
          <Field label="Contract (effective) date" htmlFor="k-contract"><Input id="k-contract" type="date" value={keys.contractDate} onChange={(e) => setKeys({ ...keys, contractDate: e.target.value })} /></Field>
          <Field label="Closing date" htmlFor="k-closing"><Input id="k-closing" type="date" value={keys.closingDate} onChange={(e) => setKeys({ ...keys, closingDate: e.target.value })} /></Field>
          {viewer.role === "admin" && (
            <Field label="Agent" htmlFor="k-agent"><Select id="k-agent" value={deal.agent?.id ?? ""} onChange={(e) => void patchDeal({ agentId: e.target.value || null })}><option value="">Unassigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</Select></Field>
          )}
          <Button type="submit" className="w-full">Save terms</Button>
          <p className="text-[0.75rem] text-ink-3">Changing the contract or closing date re-computes every open template milestone and task. Manually rescheduled items stay put.</p>
        </form>

        <section className="rounded-[24px] bg-paper p-6 ring-1 ring-line xl:col-span-2" aria-labelledby="ms-h">
          <h2 id="ms-h" className="type-headline">Milestones</h2>
          <ul className="mt-3 divide-y divide-line">
            {d.milestones.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <input type="checkbox" checked={m.done} onChange={(e) => void item({ kind: "milestone", itemId: m.id, done: e.target.checked })} className="size-4 accent-[var(--gold)]" aria-label={`Mark ${m.label} ${m.done ? "not done" : "done"}`} />
                <span className={cn("flex-1", m.done && "text-ink-3 line-through")}>{m.label}{m.clientVisible && <Badge className="ml-2" tone="neutral">client sees</Badge>}</span>
                <input type="date" value={m.dueOn ?? ""} onChange={(e) => void item({ kind: "milestone", itemId: m.id, dueOn: e.target.value || null })} className={cn("rounded-lg border border-line bg-transparent px-2 py-1 text-[0.8125rem]", tone(m.urgency))} aria-label={`${m.label} due date`} />
                {!m.done && m.dueOn && <button type="button" onClick={() => void generate("deadline_reminder", m.id)} className="text-[0.75rem] underline underline-offset-2" disabled={draftBusy}>Draft reminder</button>}
              </li>
            ))}
          </ul>
          <h2 className="type-headline mt-8">Tasks</h2>
          <ul className="mt-3 divide-y divide-line">
            {d.tasks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <input type="checkbox" checked={t.status !== "open"} onChange={(e) => void item({ kind: "task", itemId: t.id, done: e.target.checked })} className="size-4 accent-[var(--gold)]" aria-label={`Mark ${t.title} done`} />
                <span className={cn("flex-1", t.status !== "open" && "text-ink-3 line-through")}>{t.title}</span>
                <select value={t.assignee?.id ?? ""} onChange={(e) => void item({ kind: "task", itemId: t.id, assigneeId: e.target.value || null })} className="rounded-lg border border-line bg-transparent px-2 py-1 text-[0.8125rem]" aria-label={`${t.title} assignee`}>
                  <option value="">Unassigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                </select>
                <input type="date" value={t.dueOn ?? ""} onChange={(e) => void item({ kind: "task", itemId: t.id, dueOn: e.target.value || null })} className={cn("rounded-lg border border-line bg-transparent px-2 py-1 text-[0.8125rem]", tone(t.urgency))} aria-label={`${t.title} due date`} />
                <button type="button" aria-label={`Delete ${t.title}`} onClick={async () => { await api(`/api/deals/${id}/items?kind=task&itemId=${t.id}`, { method: "DELETE" }); void load(); }} className="text-ink-3 hover:text-danger"><Trash2 className="size-4" /></button>
              </li>
            ))}
          </ul>
          <form onSubmit={addItem} className="mt-4 flex flex-wrap gap-2">
            <label htmlFor="ni-kind" className="sr-only">Type</label>
            <Select id="ni-kind" value={newItem.kind} onChange={(e) => setNewItem({ ...newItem, kind: e.target.value })} className="h-10 w-32"><option value="task">Task</option><option value="milestone">Milestone</option></Select>
            <label htmlFor="ni-title" className="sr-only">Title</label>
            <Input id="ni-title" value={newItem.title} onChange={(e) => setNewItem({ ...newItem, title: e.target.value })} placeholder="Add an item" className="h-10 flex-1" />
            <label htmlFor="ni-due" className="sr-only">Due</label>
            <Input id="ni-due" type="date" value={newItem.dueOn} onChange={(e) => setNewItem({ ...newItem, dueOn: e.target.value })} className="h-10 w-40" />
            <Button type="submit" size="sm" className="h-10"><Plus /> Add</Button>
          </form>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-[24px] bg-paper p-6 ring-1 ring-line" aria-labelledby="docs-h">
          <h2 id="docs-h" className="type-headline">Documents</h2>
          <p className="mt-1 text-[0.8125rem] text-ink-3">Private to people who can access this deal. PDF, JPEG, PNG or text, up to 25 MB.</p>
          <form onSubmit={uploadDoc} className="mt-4 space-y-3 rounded-2xl border border-dashed border-line-strong p-4">
            <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,text/plain" aria-label="Choose a document" className="text-sm" />
            <Input value={upload.label} onChange={(e) => setUpload({ ...upload, label: e.target.value })} placeholder="Label, e.g. Purchase & sale agreement" aria-label="Document label" className="h-10" />
            <label className="flex items-center gap-2 text-[0.8125rem]"><input type="checkbox" checked={upload.extract} onChange={(e) => setUpload({ ...upload, extract: e.target.checked })} className="accent-[var(--gold)]" /> Find price & dates for me to review (PDF / text)</label>
            {upload.error && <p className="text-sm text-danger">{upload.error}</p>}
            <Button type="submit" size="sm" disabled={upload.busy}><FileUp /> {upload.busy ? "Uploading…" : "Upload"}</Button>
          </form>
          <ul className="mt-4 space-y-3">
            {d.documents.map((doc) => (
              <li key={doc.id} className="rounded-2xl ring-1 ring-line p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span><span className="font-medium">{doc.label}</span><span className="block text-[0.75rem] text-ink-3">{doc.fileName} · {(doc.bytes / 1024).toFixed(0)} KB</span></span>
                  <span className="flex items-center gap-2">
                    <a href={`/api/deals/${id}/documents/${doc.id}`} className="pressable grid size-8 place-items-center rounded-full hover:bg-fill" aria-label={`Download ${doc.label}`}><Download className="size-4" /></a>
                    <button type="button" aria-label={`Delete ${doc.label}`} onClick={async () => { if (confirm(`Delete ${doc.label}?`)) { await api(`/api/deals/${id}/documents/${doc.id}`, { method: "DELETE" }); void load(); } }} className="pressable grid size-8 place-items-center rounded-full text-ink-3 hover:text-danger"><Trash2 className="size-4" /></button>
                  </span>
                </div>
                {doc.extractionStatus !== "not_extracted" && (
                  <div className="mt-3 rounded-xl bg-fill p-3">
                    <p className="text-[0.75rem] font-medium">{doc.extractionStatus === "needs_review" ? "Found values — please verify against the document" : `Extraction ${doc.extractionStatus}`}</p>
                    {doc.extracted.length === 0 ? <p className="mt-1 text-[0.75rem] text-ink-3">No candidate values found.</p> : (
                      <ul className="mt-2 space-y-1.5 text-[0.8125rem]">{doc.extracted.map((x) => <li key={x.field}><span className="font-medium">{x.label}:</span> {x.field.includes("price") || x.field.includes("money") ? formatPrice(Number(x.normalized)) : String(x.normalized)}<span className="block text-[0.6875rem] text-ink-3">{x.source}</span></li>)}</ul>
                    )}
                    {doc.extractionStatus === "needs_review" && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => void reviewDoc(doc, "verified", doc.extracted.map((x) => x.field).filter((f) => ["purchase_price", "closing_date", "effective_date"].includes(f)))}><Check /> Verified — apply to deal</Button>
                        <Button size="sm" variant="outline" onClick={() => void reviewDoc(doc, "verified")}>Verified, don&rsquo;t apply</Button>
                        <Button size="sm" variant="ghost" onClick={() => void reviewDoc(doc, "rejected")}>Incorrect</Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section id="drafts" className="rounded-[24px] bg-paper p-6 ring-1 ring-line" aria-labelledby="drafts-h">
          <h2 id="drafts-h" className="type-headline">Client messages</h2>
          <p className="mt-1 text-[0.8125rem] text-ink-3">Drafts are never sent automatically. Edit, approve, send from your own email, then mark as sent.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={draftBusy} onClick={() => void generate("status_update")}><Mail /> Status update</Button>
            <Button size="sm" variant="outline" disabled={draftBusy} onClick={() => void generate("document_request")}>Request documents</Button>
            <Button size="sm" variant="outline" disabled={draftBusy} onClick={() => void generate("status_update", undefined, true)}><Sparkles /> Update (AI-polished)</Button>
          </div>
          <ul className="mt-4 space-y-3">
            {d.drafts.length === 0 && <li className="text-sm text-ink-3">No drafts yet.</li>}
            {d.drafts.map((dr) => {
              const ed = editing[dr.id];
              return (
                <li key={dr.id} className="rounded-2xl ring-1 ring-line p-4 text-sm">
                  <div className="flex items-center justify-between gap-2"><Badge tone={dr.status === "approved" ? "success" : dr.status === "sent_manually" ? "neutral" : "warn"}>{dr.status.replace("_", " ")}</Badge>{dr.aiGenerated && <span className="text-[0.75rem] text-ink-3">AI-polished · review carefully</span>}</div>
                  {ed ? (
                    <div className="mt-3 space-y-2">
                      <Input value={ed.to} onChange={(e) => setEditing({ ...editing, [dr.id]: { ...ed, to: e.target.value } })} placeholder="To" aria-label="To" className="h-9" />
                      <Input value={ed.subject} onChange={(e) => setEditing({ ...editing, [dr.id]: { ...ed, subject: e.target.value } })} aria-label="Subject" className="h-9" />
                      <Textarea value={ed.body} onChange={(e) => setEditing({ ...editing, [dr.id]: { ...ed, body: e.target.value } })} aria-label="Body" rows={9} />
                      <div className="flex gap-2"><Button size="sm" onClick={() => void draftAction(dr, "save")}>Save edits</Button><Button size="sm" variant="ghost" onClick={() => setEditing((x) => { const c = { ...x }; delete c[dr.id]; return c; })}>Cancel</Button></div>
                    </div>
                  ) : (
                    <>
                      <p className="mt-2 font-medium">{dr.subject}</p>
                      <p className="text-[0.75rem] text-ink-3">To: {dr.to ?? "add a recipient"}</p>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-sans text-[0.8125rem] text-ink-2">{dr.body}</pre>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {dr.status === "draft" && <><Button size="sm" variant="outline" onClick={() => setEditing({ ...editing, [dr.id]: { subject: dr.subject, body: dr.body, to: dr.to ?? "" } })}>Edit</Button><Button size="sm" onClick={() => void draftAction(dr, "approve")}><Check /> Approve</Button></>}
                        {dr.status === "approved" && (
                          <>
                            <a href={mailto[dr.id] ?? `mailto:${encodeURIComponent(dr.to ?? "")}?subject=${encodeURIComponent(dr.subject)}&body=${encodeURIComponent(dr.body)}`} className="pressable inline-flex h-8 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[0.8125rem] text-paper"><Mail className="size-3.5" /> Open in email</a>
                            <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(`${dr.subject}\n\n${dr.body}`)}><Copy /> Copy</Button>
                            <Button size="sm" variant="outline" onClick={() => void draftAction(dr, "mark_sent")}>I sent it</Button>
                          </>
                        )}
                        {dr.status !== "sent_manually" && <Button size="sm" variant="ghost" onClick={() => void draftAction(dr, "discard")}>Discard</Button>}
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section className="rounded-[24px] bg-paper p-6 ring-1 ring-line" aria-labelledby="act-h">
        <h2 id="act-h" className="type-headline">Activity</h2>
        <ol className="mt-3 space-y-1.5 text-[0.8125rem]">
          {d.activity.map((a, i) => <li key={i} className="flex gap-3"><span className="w-40 shrink-0 text-ink-3">{new Date(a.at).toLocaleString("en-US")}</span><span><span className="font-medium">{a.actor ?? "System"}</span> · {a.action.replace(/[._]/g, " ")}{a.data?.to ? ` → ${STAGE_LABEL[a.data.to as DealStage] ?? a.data.to}` : ""}</span></li>)}
        </ol>
      </section>

      {viewer.role === "admin" && (
        <button type="button" className="text-sm text-danger underline" onClick={async () => { if (confirm("Delete this deal and its documents permanently?")) { await api(`/api/deals/${id}`, { method: "DELETE" }); router.replace("/admin/deals"); } }}>Delete deal</button>
      )}
      <p className="text-[0.75rem] text-ink-3">Workflow assistance only — not legal advice. Contract deadlines are whatever the signed agreement says.</p>
    </div>
  );
}
