import { after } from "next/server";
import { z } from "zod";
import { contextFor, requireStaff } from "@/lib/server/auth";
import { withDb, withSystemDb } from "@/lib/server/db";
import { DEAL_SELECT, statusSummary, toDealSummary, updateTransaction, type DealSummaryRow } from "@/lib/server/deals";
import { deleteDocument } from "@/lib/server/documents";
import { assertUuid, handler, notFound, parseBody } from "@/lib/server/http";
import { DEAL_STAGES, urgency } from "@/lib/deal-rules";

export const GET = handler(async (request: Request, { params }: RouteContext<"/api/deals/[id]">) => {
  const { id } = await params;
  assertUuid(id, "Deal");
  const viewer = await requireStaff(request);
  const data = await withDb(contextFor(viewer), async (db) => {
    const row = await db.one<DealSummaryRow & { notes: string | null; lost_reason: string | null; lead_id: string | null }>(
      `SELECT d.*, t.notes, t.lost_reason, t.lead_id FROM (${DEAL_SELECT} WHERE t.id = $1) d JOIN transactions t ON t.id = d.id`,
      [id],
    );
    if (!row) throw notFound("Deal");
    const milestones = await db.query<{ id: string; label: string; due_on: string | null; completed_at: Date | null; rule: string | null; client_visible: boolean }>(
      "SELECT id, label, due_on, completed_at, rule, client_visible FROM transaction_milestones WHERE transaction_id = $1 ORDER BY due_on NULLS LAST, sort_order",
      [id],
    );
    const tasks = await db.query<{ id: string; title: string; due_on: string | null; status: string; assignee_id: string | null; assignee_name: string | null }>(
      `SELECT k.id, k.title, k.due_on, k.status::text, k.assignee_id, u.full_name AS assignee_name
         FROM transaction_tasks k LEFT JOIN users u ON u.id = k.assignee_id WHERE k.transaction_id = $1 ORDER BY k.status, k.due_on NULLS LAST, k.created_at`,
      [id],
    );
    const documents = await db.query<{ id: string; label: string; file_name: string; mime_type: string; bytes: number; extraction_status: string; extracted: unknown[]; created_at: Date }>(
      "SELECT id, label, file_name, mime_type, bytes, extraction_status::text, extracted, created_at FROM transaction_documents WHERE transaction_id = $1 ORDER BY created_at DESC",
      [id],
    );
    const drafts = await db.query<{ id: string; to_email: string | null; subject: string; body: string; status: string; ai_generated: boolean; created_at: Date; approved_at: Date | null }>(
      "SELECT id, to_email, subject, body, status::text, ai_generated, created_at, approved_at FROM communication_drafts WHERE transaction_id = $1 AND status <> 'discarded' ORDER BY created_at DESC",
      [id],
    );
    return { row, milestones, tasks, documents, drafts };
  });
  // Activity history: access to the deal was just verified through RLS above.
  const activity = await withSystemDb((db) =>
    db.query<{ action: string; data: Record<string, unknown>; actor: string | null; created_at: Date }>(
      `SELECT a.action, a.data, u.full_name AS actor, a.created_at FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.entity_type = 'transaction' AND a.entity_id = $1 ORDER BY a.created_at DESC LIMIT 50`,
      [id],
    ),
  );
  const today = new Date().toISOString().slice(0, 10);
  const deal = toDealSummary(data.row);
  return Response.json({
    deal: { ...deal, notes: data.row.notes, lostReason: data.row.lost_reason, leadId: data.row.lead_id },
    summary: statusSummary(deal, data.milestones, data.tasks),
    milestones: data.milestones.map((m) => ({ id: m.id, label: m.label, dueOn: m.due_on, done: Boolean(m.completed_at), rule: m.rule, clientVisible: m.client_visible, urgency: urgency(m.due_on, Boolean(m.completed_at), today) })),
    tasks: data.tasks.map((t) => ({ id: t.id, title: t.title, dueOn: t.due_on, status: t.status, assignee: t.assignee_id ? { id: t.assignee_id, name: t.assignee_name } : null, urgency: urgency(t.due_on, t.status !== "open", today) })),
    documents: data.documents.map((d) => ({ id: d.id, label: d.label, fileName: d.file_name, mimeType: d.mime_type, bytes: d.bytes, extractionStatus: d.extraction_status, extracted: d.extracted, createdAt: d.created_at.toISOString() })),
    drafts: data.drafts.map((d) => ({ id: d.id, to: d.to_email, subject: d.subject, body: d.body, status: d.status, aiGenerated: d.ai_generated, createdAt: d.created_at.toISOString(), approvedAt: d.approved_at?.toISOString() ?? null })),
    activity: activity.map((a) => ({ action: a.action, data: a.data, actor: a.actor, at: a.created_at.toISOString() })),
  });
});

const patchSchema = z.object({
  title: z.string().trim().min(2).max(140).optional(),
  stage: z.enum(DEAL_STAGES).optional(),
  priceCents: z.number().int("Whole cents only.").min(0).max(100_000_000_000).nullable().optional(),
  commissionBps: z.number().int().min(0).max(1500).nullable().optional(),
  contractDate: z.iso.date().nullable().optional(),
  closingDate: z.iso.date().nullable().optional(),
  lostReason: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  agentId: z.uuid().nullable().optional(),
  clientEmail: z.email().trim().toLowerCase().nullable().optional(),
});

export const PATCH = handler(async (request: Request, { params }: RouteContext<"/api/deals/[id]">) => {
  const { id } = await params;
  assertUuid(id, "Deal");
  const viewer = await requireStaff(request);
  const input = await parseBody(request, patchSchema);
  const result = await updateTransaction(viewer, id, input);
  // deal.stage_changed is recorded in the outbox inside updateTransaction's transaction.
  return Response.json({ ok: true, stage: result.stage });
});

export const DELETE = handler(async (request: Request, { params }: RouteContext<"/api/deals/[id]">) => {
  const { id } = await params;
  assertUuid(id, "Deal");
  const viewer = await requireStaff(request);
  const keys = await withDb(contextFor(viewer), async (db) => {
    const docs = await db.query<{ storage_key: string }>("SELECT storage_key FROM transaction_documents WHERE transaction_id = $1", [id]);
    const rows = await db.query("DELETE FROM transactions WHERE id = $1 RETURNING id", [id]);
    if (!rows.length) throw notFound("Deal");
    await db.query("INSERT INTO audit_log (team_id, actor_id, action, entity_type, entity_id) VALUES ($1, $2, 'deal.deleted', 'transaction', $3)", [viewer.teamId, viewer.id, id]);
    return docs.map((d) => d.storage_key);
  });
  after(() => Promise.all(keys.map(deleteDocument)));
  return new Response(null, { status: 204 });
});
