import "server-only";
import { STAGE_LABEL, commissionCents, urgency } from "@/lib/deal-rules";
import { formatPrice } from "@/lib/money";
import type { Viewer } from "@/lib/types";
import { contextFor } from "./auth";
import { withDb } from "./db";
import { DEAL_SELECT, statusSummary, toDealSummary, type DealSummaryRow } from "./deals";
import { generateDealDraft } from "./drafts";

/**
 * The team's operations assistant. Every answer comes from a database query run with the
 * asker's own permissions (RLS), so an agent only ever hears about their own deals and leads.
 * It can prepare drafts, but never sends anything.
 */
export interface OpsAnswer {
  answer: string;
  items?: { label: string; detail?: string; href?: string; tone?: "danger" | "warn" | "ok" }[];
  links?: { label: string; href: string }[];
}

const HELP: OpsAnswer = {
  answer: "I can tell you what's overdue or due this week, summarize the pipeline, list new leads or showing requests, give the status of a deal (\"status of Lake House\"), and draft a client update or reminder for your approval (\"draft update for Red Barn\").",
};

async function findDeal(viewer: Viewer & { teamId: string }, text: string) {
  const words = text.replace(/\b(status|of|the|for|deal|draft|update|reminder|email|a|an|on|with|send|write|where|is|are|we|what's|whats)\b/gi, " ").trim();
  if (words.length < 3) return null;
  const rows = await withDb(contextFor(viewer), (db) =>
    db.query<DealSummaryRow>(`${DEAL_SELECT} WHERE t.title ILIKE $1 OR t.client_name ILIKE $1 OR p.title ILIKE $1 ORDER BY t.updated_at DESC LIMIT 1`, [`%${words.split(/\s+/).slice(0, 4).join("%")}%`]),
  );
  return rows[0] ?? null;
}

export async function answerOps(viewer: Viewer & { teamId: string }, question: string): Promise<OpsAnswer> {
  const q = question.toLowerCase();
  const ctx = contextFor(viewer);
  const today = new Date().toISOString().slice(0, 10);

  if (/\b(draft|write|prepare)\b.*\b(update|reminder|email|message)\b/.test(q)) {
    const deal = await findDeal(viewer, question);
    if (!deal) return { answer: "Which deal? Try \"draft update for <deal or client name>\"." };
    const kind = /remind/.test(q) ? "deadline_reminder" : "status_update";
    let itemId: string | null = null;
    if (kind === "deadline_reminder") {
      const next = await withDb(ctx, (db) => db.one<{ id: string }>("SELECT id FROM transaction_milestones WHERE transaction_id = $1 AND completed_at IS NULL AND due_on IS NOT NULL ORDER BY due_on LIMIT 1", [deal.id]));
      itemId = next?.id ?? null;
    }
    const draft = await generateDealDraft(viewer, deal.id, itemId ? kind : "status_update", itemId, false);
    return {
      answer: `I drafted "${draft.subject}" for ${deal.client_name}. It's waiting for your review — nothing has been sent.`,
      links: [{ label: "Review & approve the draft", href: `/admin/deals/${deal.id}#drafts` }],
    };
  }

  if (/\b(overdue|due|deadline|this week|today|upcoming|agenda|to ?do)\b/.test(q)) {
    const rows = await withDb(ctx, (db) =>
      db.query<{ title: string; due_on: string; deal_id: string; deal_title: string }>(
        `SELECT * FROM (
           SELECT m.label AS title, m.due_on, t.id AS deal_id, t.title AS deal_title FROM transaction_milestones m JOIN transactions t ON t.id = m.transaction_id
            WHERE m.completed_at IS NULL AND m.due_on <= current_date + 7 AND t.stage NOT IN ('closed', 'lost')
           UNION ALL
           SELECT k.title, k.due_on, t.id, t.title FROM transaction_tasks k JOIN transactions t ON t.id = k.transaction_id
            WHERE k.status = 'open' AND k.due_on <= current_date + 7 AND t.stage NOT IN ('closed', 'lost')
         ) x ORDER BY due_on LIMIT 15`,
      ),
    );
    const overdue = rows.filter((r) => r.due_on < today).length;
    return {
      answer: rows.length ? `${rows.length} item${rows.length === 1 ? "" : "s"} due in the next 7 days${overdue ? `, ${overdue} already overdue` : ""}.` : "Nothing is due in the next 7 days.",
      items: rows.map((r) => ({ label: r.title, detail: `${r.deal_title} · ${r.due_on}`, href: `/admin/deals/${r.deal_id}`, tone: urgency(r.due_on, false, today) === "overdue" ? "danger" : urgency(r.due_on, false, today) === "due_soon" ? "warn" : undefined })),
    };
  }

  if (/\b(pipeline|commission|revenue|how many deals|deals in)\b/.test(q)) {
    const rows = await withDb(ctx, (db) => db.query<DealSummaryRow>(`${DEAL_SELECT} WHERE t.stage NOT IN ('lost') ORDER BY t.updated_at DESC`));
    const deals = rows.map(toDealSummary);
    const open = deals.filter((d) => d.stage !== "closed");
    const value = open.reduce((a, d) => a + (d.priceCents ?? 0), 0);
    const commission = open.reduce((a, d) => a + (commissionCents(d.priceCents, d.commissionBps) ?? 0), 0);
    const byStage = Object.entries(Object.groupBy(open, (d) => d.stage)).map(([stage, ds]) => `${STAGE_LABEL[stage as keyof typeof STAGE_LABEL]}: ${ds?.length ?? 0}`);
    return {
      answer: `${open.length} open deal${open.length === 1 ? "" : "s"} worth ${formatPrice(value)} in contract or list price, with about ${formatPrice(commission)} in estimated gross commission (from each deal's entered rate).`,
      items: byStage.map((s) => ({ label: s })),
      links: [{ label: "Open the deal board", href: "/admin/deals" }],
    };
  }

  if (/\b(leads?|inquir|new contacts?)\b/.test(q)) {
    const rows = await withDb(ctx, (db) =>
      db.query<{ id: string; contact_name: string; source: string; status: string; created_at: Date }>(
        "SELECT id, contact_name, source::text, status::text, created_at FROM leads WHERE status IN ('new', 'contacted', 'qualified') ORDER BY created_at DESC LIMIT 10",
      ),
    );
    return {
      answer: rows.length ? `${rows.filter((r) => r.status === "new").length} new and ${rows.filter((r) => r.status !== "new").length} in progress (showing up to 10).` : "No open leads right now.",
      items: rows.map((r) => ({ label: r.contact_name, detail: `${r.source.replace("_", " ")} · ${r.status} · ${r.created_at.toISOString().slice(0, 10)}`, href: `/admin/leads?open=${r.id}` })),
    };
  }

  if (/\b(showings?|tours?)\b/.test(q)) {
    const rows = await withDb(ctx, (db) =>
      db.query<{ contact_name: string; starts_at: Date; status: string; title: string }>(
        "SELECT s.contact_name, s.starts_at, s.status::text, p.title FROM showings s JOIN properties p ON p.id = s.property_id WHERE s.starts_at > now() AND s.status IN ('requested', 'confirmed') ORDER BY s.starts_at LIMIT 10",
      ),
    );
    return {
      answer: rows.length ? `${rows.filter((r) => r.status === "requested").length} awaiting confirmation, ${rows.filter((r) => r.status === "confirmed").length} confirmed.` : "No upcoming showings.",
      items: rows.map((r) => ({ label: `${r.title} — ${r.contact_name}`, detail: `${r.starts_at.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })} · ${r.status}`, href: "/admin/showings", tone: r.status === "requested" ? "warn" : "ok" })),
    };
  }

  if (/\b(status|where|update on|how is|progress)\b/.test(q)) {
    const deal = await findDeal(viewer, question);
    if (!deal) return { answer: "I couldn't find a deal by that name among the deals you can access." };
    const summary = toDealSummary(deal);
    const [milestones, tasks] = await withDb(ctx, (db) =>
      Promise.all([
        db.query<{ label: string; due_on: string | null; completed_at: Date | null }>("SELECT label, due_on, completed_at FROM transaction_milestones WHERE transaction_id = $1", [deal.id]),
        db.query<{ title: string; due_on: string | null; status: string }>("SELECT title, due_on, status::text FROM transaction_tasks WHERE transaction_id = $1", [deal.id]),
      ]),
    );
    return { answer: statusSummary(summary, milestones, tasks), links: [{ label: `Open ${deal.title}`, href: `/admin/deals/${deal.id}` }] };
  }

  return HELP;
}
