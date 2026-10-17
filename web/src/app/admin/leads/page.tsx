"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { Handshake } from "lucide-react";
import { useStaff } from "@/components/admin/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiClientError } from "@/lib/client-api";
import { useLiveEvents } from "@/lib/use-live";
import { cn } from "@/lib/utils";

interface Lead {
  id: string;
  source: string;
  status: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  message: string | null;
  preferences: Record<string, unknown>;
  summary: string | null;
  property: { id: string; title: string | null; slug: string | null } | null;
  agent: { id: string; name: string | null } | null;
  nextFollowUpOn: string | null;
  noteCount: number;
  transactionId: string | null;
  createdAt: string;
}
interface Detail { lead: Lead; notes: { id: string; body: string; author: string | null; created_at: string }[]; consents: { purpose: string; granted: boolean; text_version: string; recorded_at: string }[] }

const STATUSES = ["new", "contacted", "qualified", "nurturing", "converted", "lost"] as const;
const TONE: Record<string, "warn" | "success" | "neutral" | "danger" | "gold"> = { new: "warn", contacted: "gold", qualified: "success", nurturing: "neutral", converted: "success", lost: "danger" };
const SOURCE_LABEL: Record<string, string> = { ai_assistant: "AI assistant", contact_form: "Contact form", showing_request: "Showing request", dual_move: "Dual-Move", signup: "Sign-up", manual: "Manual", import: "Import" };

function LeadsPage() {
  const viewer = useStaff();
  const router = useRouter();
  const params = useSearchParams();
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [filter, setFilter] = useState<string>("open");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [staff, setStaff] = useState<{ id: string; fullName: string }[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const openId = params.get("open");

  const load = useCallback(async () => setLeads((await api<{ leads: Lead[] }>("/api/leads")).leads), []);
  const loadDetail = useCallback(async (id: string) => setDetail(await api<Detail>(`/api/leads/${id}`)), []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void load();
    api<{ staff: { id: string; fullName: string }[] }>("/api/team/staff").then((r) => setStaff(r.staff));
  }, [load]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- open the lead named in the URL
    if (openId) void loadDetail(openId);
    else setDetail(null);
  }, [openId, loadDetail]);
  useLiveEvents(() => {
    void load();
    if (openId) void loadDetail(openId);
  }, (e) => e.table === "leads");

  async function patch(body: Record<string, unknown>) {
    if (!detail) return;
    setError("");
    try {
      await api(`/api/leads/${detail.lead.id}`, { method: "PATCH", body });
      await Promise.all([load(), loadDetail(detail.lead.id)]);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't update.");
    }
  }
  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!detail || !note.trim()) return;
    await api(`/api/leads/${detail.lead.id}/notes`, { method: "POST", body: { body: note } });
    setNote("");
    await loadDetail(detail.lead.id);
  }
  async function convert(side: string) {
    if (!detail) return;
    try {
      const r = await api<{ transactionId: string }>(`/api/leads/${detail.lead.id}/convert`, { method: "POST", body: { side } });
      router.push(`/admin/deals/${r.transactionId}`);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't create the deal.");
    }
  }

  const visible = (leads ?? []).filter((l) => (filter === "open" ? !["converted", "lost"].includes(l.status) : filter === "all" ? true : l.status === filter)).filter((l) => !q || `${l.contactName} ${l.contactEmail ?? ""} ${l.property?.title ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <h1 className="type-title">Leads</h1>
      <p className="mt-1 text-ink-2">{viewer.role === "admin" ? "Every inquiry for the team." : "Leads assigned to you, plus unassigned ones you can claim."} Each was created only after the person asked for help and consented to contact.</p>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {["open", ...STATUSES, "all"].map((s) => (
          <button key={s} type="button" onClick={() => setFilter(s)} aria-pressed={filter === s} className={cn("pressable rounded-full border px-3.5 py-1.5 text-[0.8125rem] capitalize", filter === s ? "border-ink bg-ink text-paper" : "border-line-strong")}>{s}</button>
        ))}
        <label htmlFor="lead-q" className="sr-only">Search leads</label>
        <Input id="lead-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, home" className="ml-auto h-9 w-64" />
      </div>
      <div className="mt-6 overflow-hidden rounded-[24px] bg-paper ring-1 ring-line">
        {leads === null ? <div className="p-6"><Skeleton className="h-40" /></div> : visible.length === 0 ? (
          <p className="p-10 text-center text-ink-2">No leads here. Inquiries from the contact form, AI assistant, showing requests and Dual-Move plans appear automatically.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-[0.75rem] uppercase tracking-[0.1em] text-ink-3"><tr><th className="px-5 py-3 font-medium">Contact</th><th className="hidden px-5 py-3 font-medium md:table-cell">Source</th><th className="hidden px-5 py-3 font-medium lg:table-cell">Home</th><th className="hidden px-5 py-3 font-medium sm:table-cell">Agent</th><th className="px-5 py-3 font-medium">Status</th></tr></thead>
            <tbody className="divide-y divide-line">
              {visible.map((l) => (
                <tr key={l.id} className="cursor-pointer hover:bg-fill/50" onClick={() => router.push(`/admin/leads?open=${l.id}`)}>
                  <td className="px-5 py-3"><button type="button" className="text-left font-medium hover:underline">{l.contactName}</button><span className="block text-ink-3">{new Date(l.createdAt).toLocaleDateString("en-US")}{l.nextFollowUpOn ? ` · follow up ${l.nextFollowUpOn}` : ""}</span></td>
                  <td className="hidden px-5 py-3 md:table-cell">{SOURCE_LABEL[l.source] ?? l.source}</td>
                  <td className="hidden px-5 py-3 lg:table-cell">{l.property?.title ?? "—"}</td>
                  <td className="hidden px-5 py-3 sm:table-cell">{l.agent?.name ?? <span className="text-warn">Unassigned</span>}</td>
                  <td className="px-5 py-3"><Badge tone={TONE[l.status]}>{l.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={Boolean(openId)} onOpenChange={(o) => !o && router.push("/admin/leads")}>
        <DialogContent className="w-[min(720px,calc(100vw-2rem))]">
          {!detail ? <Skeleton className="h-64" /> : (
            <div>
              <DialogTitle>{detail.lead.contactName}</DialogTitle>
              <DialogDescription>
                {SOURCE_LABEL[detail.lead.source] ?? detail.lead.source} · {new Date(detail.lead.createdAt).toLocaleString("en-US")}
                {detail.lead.property && <> · <Link href={`/listings/${detail.lead.property.slug}`} target="_blank" className="underline">{detail.lead.property.title}</Link></>}
              </DialogDescription>
              <div className="mt-5 flex flex-wrap gap-4 text-sm">
                {detail.lead.contactEmail && <a href={`mailto:${detail.lead.contactEmail}`} className="underline underline-offset-4">{detail.lead.contactEmail}</a>}
                {detail.lead.contactPhone && <a href={`tel:${detail.lead.contactPhone}`} className="underline underline-offset-4">{detail.lead.contactPhone}</a>}
              </div>
              {detail.lead.message && <p className="mt-4 rounded-2xl bg-fill p-4 text-sm">{detail.lead.message}</p>}
              {Object.keys(detail.lead.preferences).length > 0 && <p className="mt-3 text-sm text-ink-2"><span className="font-medium text-ink">Stated preferences:</span> {Object.entries(detail.lead.preferences).map(([k, v]) => `${k.replace(/_/g, " ")}: ${Array.isArray(v) ? v.join(", ") : String(v)}`).join(" · ")}</p>}
              {detail.lead.summary && <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-2xl bg-fill p-4 text-[0.8125rem]">{detail.lead.summary}</pre>}
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <label className="text-[0.8125rem] text-ink-2">Status<Select value={detail.lead.status} onChange={(e) => void patch({ status: e.target.value })} className="mt-1 h-10">{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></label>
                <label className="text-[0.8125rem] text-ink-2">Assigned to
                  {viewer.role === "admin" ? (
                    <Select value={detail.lead.agent?.id ?? ""} onChange={(e) => void patch({ assignedAgentId: e.target.value || null })} className="mt-1 h-10"><option value="">Unassigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</Select>
                  ) : detail.lead.agent ? <span className="mt-1 block text-sm text-ink">{detail.lead.agent.name}</span> : <Button size="sm" variant="outline" className="mt-1 h-10 w-full" onClick={() => void patch({ assignedAgentId: viewer.id })}>Claim this lead</Button>}
                </label>
                <label className="text-[0.8125rem] text-ink-2">Follow up on<Input type="date" value={detail.lead.nextFollowUpOn ?? ""} onChange={(e) => void patch({ nextFollowUpOn: e.target.value || null })} className="mt-1 h-10" /></label>
              </div>
              {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
              <div className="mt-5 flex flex-wrap gap-2">
                {detail.lead.transactionId ? <Link href={`/admin/deals/${detail.lead.transactionId}`} className="text-sm font-medium underline underline-offset-4">Open the deal →</Link> : (
                  <>
                    <Button size="sm" onClick={() => void convert("buyer")}><Handshake /> Start buyer deal</Button>
                    <Button size="sm" variant="outline" onClick={() => void convert("seller")}>Start seller deal</Button>
                    <Button size="sm" variant="outline" onClick={() => void convert("lease")}>Start lease</Button>
                  </>
                )}
              </div>
              <section className="mt-6 border-t border-line pt-5">
                <h3 className="text-sm font-medium">Notes</h3>
                <ul className="mt-3 space-y-2 text-sm">{detail.notes.length === 0 ? <li className="text-ink-3">No notes yet.</li> : detail.notes.map((n) => <li key={n.id} className="rounded-xl bg-fill p-3">{n.body}<span className="mt-1 block text-[0.75rem] text-ink-3">{n.author ?? "System"} · {new Date(n.created_at).toLocaleString("en-US")}</span></li>)}</ul>
                <form onSubmit={addNote} className="mt-3 flex gap-2"><label htmlFor="lead-note" className="sr-only">Add a note</label><Textarea id="lead-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (internal)" className="min-h-11" /><Button type="submit" size="sm" disabled={!note.trim()}>Add</Button></form>
              </section>
              <p className="mt-5 text-[0.75rem] text-ink-3">Consent: {detail.consents.map((c) => `${c.purpose} ${c.granted ? "granted" : "withdrawn"} (${c.text_version}, ${new Date(c.recorded_at).toLocaleDateString("en-US")})`).join(" · ") || "recorded at intake"}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <LeadsPage />
    </Suspense>
  );
}
