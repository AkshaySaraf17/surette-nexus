import "server-only";
import {
  DEFAULT_TEMPLATES,
  STAGE_LABEL,
  commissionCents,
  dueFromRule,
  resolveTemplate,
  stageRequirements,
  urgency,
  type DealSide,
  type DealStage,
  type TemplateItem,
} from "@/lib/deal-rules";
import type { Viewer } from "@/lib/types";
import { withDb, type Db } from "./db";
import { publishEvent } from "./events";
import { contextFor } from "./auth";
import { ApiError, notFound } from "./errors";

/** Transactions (deals): creation, stage changes, template checklists and key-date recalculation. */

export interface DealInput {
  title: string;
  side: DealSide;
  stage?: DealStage;
  propertyId?: string | null;
  leadId?: string | null;
  clientUserId?: string | null;
  clientName: string;
  clientEmail?: string | null;
  agentId?: string | null;
  priceCents?: number | null;
  commissionBps?: number | null;
  contractDate?: string | null;
  closingDate?: string | null;
  notes?: string | null;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

async function audit(db: Db, viewer: Viewer, action: string, dealId: string, data: Record<string, unknown> = {}) {
  await db.query("INSERT INTO audit_log (team_id, actor_id, action, entity_type, entity_id, data) VALUES ($1, $2, $3, 'transaction', $4, $5)", [
    viewer.teamId,
    viewer.id,
    action,
    dealId,
    data,
  ]);
}

/** Insert milestones + tasks from a template; dates resolve from the deal's key dates. */
async function applyTemplate(db: Db, dealId: string, items: TemplateItem[], dates: { contractDate: string | null; closingDate: string | null }, assigneeId: string | null) {
  for (const item of resolveTemplate(items, dates)) {
    if (item.milestone) {
      await db.query(
        "INSERT INTO transaction_milestones (transaction_id, label, due_on, sort_order, rule, client_visible) VALUES ($1, $2, $3, $4, $5, $6)",
        [dealId, item.label, item.dueOn, item.sortOrder, item.rule, item.clientVisible],
      );
    } else {
      await db.query("INSERT INTO transaction_tasks (transaction_id, title, assignee_id, due_on) VALUES ($1, $2, $3, $4)", [dealId, item.label, assigneeId, item.dueOn]);
    }
  }
}

async function templateFor(db: Db, teamId: string, side: DealSide): Promise<TemplateItem[]> {
  const custom = await db.one<{ items: TemplateItem[] }>("SELECT items FROM task_templates WHERE team_id = $1 AND side = $2::deal_side AND is_default LIMIT 1", [teamId, side]);
  return custom?.items ?? DEFAULT_TEMPLATES[side].items;
}

export async function createTransaction(viewer: Viewer & { teamId: string }, input: DealInput) {
  const stage = input.stage ?? "prospect";
  const errors = stageRequirements(stage, { contractDate: input.contractDate ?? null, closingDate: input.closingDate ?? null, priceCents: input.priceCents ?? null });
  if (Object.keys(errors).length) throw new ApiError(400, "VALIDATION_ERROR", "Some details are needed for this stage.", errors);
  const agentId = viewer.role === "admin" ? input.agentId ?? viewer.id : viewer.id;
  return withDb(contextFor(viewer), async (db) => {
    const row = await db.one<{ id: string }>(
      `INSERT INTO transactions (team_id, title, side, stage, property_id, lead_id, client_user_id, client_name, client_email, agent_id,
                                 price_cents, commission_bps, contract_date, closing_date, notes, created_by)
       VALUES ($1, $2, $3::deal_side, $4::deal_stage, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
      [
        viewer.teamId,
        input.title,
        input.side,
        stage,
        input.propertyId ?? null,
        input.leadId ?? null,
        input.clientUserId ?? null,
        input.clientName,
        input.clientEmail ?? null,
        agentId,
        input.priceCents ?? null,
        input.commissionBps ?? null,
        input.contractDate ?? null,
        input.closingDate ?? null,
        input.notes ?? null,
        viewer.id,
      ],
    );
    const items = await templateFor(db, viewer.teamId, input.side);
    await applyTemplate(db, row!.id, items, { contractDate: input.contractDate ?? null, closingDate: input.closingDate ?? null }, agentId);
    await audit(db, viewer, "deal.created", row!.id, { stage, side: input.side });
    await publishEvent(db, { type: "deal.created", teamId: viewer.teamId, aggregate: "transaction", aggregateId: row!.id, payload: { transactionId: row!.id, stage, side: input.side } });
    return { id: row!.id };
  });
}

export interface DealPatch {
  title?: string;
  stage?: DealStage;
  priceCents?: number | null;
  commissionBps?: number | null;
  contractDate?: string | null;
  closingDate?: string | null;
  lostReason?: string | null;
  notes?: string | null;
  agentId?: string | null;
  clientEmail?: string | null;
}

export async function updateTransaction(viewer: Viewer & { teamId: string }, id: string, patch: DealPatch) {
  return withDb(contextFor(viewer), async (db) => {
    const current = await db.one<{ stage: DealStage; contract_date: string | null; closing_date: string | null; price_cents: number | null; lost_reason: string | null }>(
      "SELECT stage, contract_date, closing_date, price_cents, lost_reason FROM transactions WHERE id = $1",
      [id],
    );
    if (!current) throw notFound("Deal");
    const next = {
      contractDate: patch.contractDate !== undefined ? patch.contractDate : current.contract_date,
      closingDate: patch.closingDate !== undefined ? patch.closingDate : current.closing_date,
      priceCents: patch.priceCents !== undefined ? patch.priceCents : current.price_cents,
      lostReason: patch.lostReason !== undefined ? patch.lostReason : current.lost_reason,
    };
    const stage = patch.stage ?? current.stage;
    const errors = stageRequirements(stage, next);
    if (Object.keys(errors).length) throw new ApiError(400, "VALIDATION_ERROR", `Can't move to "${STAGE_LABEL[stage]}" yet.`, errors);
    if (patch.agentId !== undefined && viewer.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Only the owner or an admin can reassign deals.");

    await db.query(
      `UPDATE transactions SET
         title = coalesce($2, title), stage = $3::deal_stage, price_cents = $4, commission_bps = CASE WHEN $5 THEN $6 ELSE commission_bps END,
         contract_date = $7, closing_date = $8, lost_reason = $9, notes = CASE WHEN $10 THEN $11 ELSE notes END,
         agent_id = CASE WHEN $12 THEN $13::uuid ELSE agent_id END, client_email = CASE WHEN $14 THEN $15 ELSE client_email END
       WHERE id = $1`,
      [
        id,
        patch.title ?? null,
        stage,
        next.priceCents,
        patch.commissionBps !== undefined,
        patch.commissionBps ?? null,
        next.contractDate,
        next.closingDate,
        stage === "lost" ? next.lostReason : null,
        patch.notes !== undefined,
        patch.notes ?? null,
        patch.agentId !== undefined,
        patch.agentId ?? null,
        patch.clientEmail !== undefined,
        patch.clientEmail ?? null,
      ],
    );

    // Key dates changed: re-derive every open, rule-based milestone and task.
    if (next.contractDate !== current.contract_date || next.closingDate !== current.closing_date) {
      const milestones = await db.query<{ id: string; rule: string | null }>("SELECT id, rule FROM transaction_milestones WHERE transaction_id = $1 AND completed_at IS NULL", [id]);
      for (const m of milestones) {
        const due = dueFromRule(m.rule, next);
        if (due !== undefined) await db.query("UPDATE transaction_milestones SET due_on = $2 WHERE id = $1", [m.id, due]);
      }
      // Tasks created from a template share the label of their template item; recompute those by matching rules.
      const side = (await db.one<{ side: DealSide; team_id: string }>("SELECT side, team_id FROM transactions WHERE id = $1", [id]))!;
      const items = resolveTemplate(await templateFor(db, side.team_id, side.side), next).filter((i) => !i.milestone);
      for (const item of items) {
        await db.query("UPDATE transaction_tasks SET due_on = $3 WHERE transaction_id = $1 AND title = $2 AND status = 'open'", [id, item.label, item.dueOn]);
      }
    }
    if (patch.stage && patch.stage !== current.stage) {
      await audit(db, viewer, "deal.stage_changed", id, { from: current.stage, to: patch.stage });
      await publishEvent(db, { type: "deal.stage_changed", teamId: viewer.teamId, aggregate: "transaction", aggregateId: id, payload: { transactionId: id, from: current.stage, to: patch.stage } });
    }
    else await audit(db, viewer, "deal.updated", id, patch as Record<string, unknown>);
    return { previousStage: current.stage, stage };
  });
}

export interface DealSummaryRow {
  id: string;
  title: string;
  side: DealSide;
  stage: DealStage;
  client_name: string;
  client_email: string | null;
  property_id: string | null;
  property_title: string | null;
  property_slug: string | null;
  agent_id: string | null;
  agent_name: string | null;
  price_cents: number | null;
  commission_bps: number | null;
  contract_date: string | null;
  closing_date: string | null;
  updated_at: Date;
  open_tasks: number;
  overdue_items: number;
  next_due_label: string | null;
  next_due_on: string | null;
}

export const DEAL_SELECT = `
  SELECT t.id, t.title, t.side, t.stage, t.client_name, t.client_email, t.property_id, p.title AS property_title, p.slug AS property_slug,
         t.agent_id, a.full_name AS agent_name, t.price_cents, t.commission_bps, t.contract_date, t.closing_date, t.updated_at,
         (SELECT count(*)::int FROM transaction_tasks k WHERE k.transaction_id = t.id AND k.status = 'open') AS open_tasks,
         ((SELECT count(*) FROM transaction_tasks k WHERE k.transaction_id = t.id AND k.status = 'open' AND k.due_on < current_date) +
          (SELECT count(*) FROM transaction_milestones m WHERE m.transaction_id = t.id AND m.completed_at IS NULL AND m.due_on < current_date))::int AS overdue_items,
         nx.label AS next_due_label, nx.due_on AS next_due_on
    FROM transactions t
    LEFT JOIN properties p ON p.id = t.property_id
    LEFT JOIN users a ON a.id = t.agent_id
    LEFT JOIN LATERAL (
      SELECT label, due_on FROM (
        SELECT m.label, m.due_on FROM transaction_milestones m WHERE m.transaction_id = t.id AND m.completed_at IS NULL AND m.due_on IS NOT NULL
        UNION ALL
        SELECT k.title, k.due_on FROM transaction_tasks k WHERE k.transaction_id = t.id AND k.status = 'open' AND k.due_on IS NOT NULL
      ) x ORDER BY due_on LIMIT 1
    ) nx ON true`;

export function toDealSummary(r: DealSummaryRow) {
  return {
    id: r.id,
    title: r.title,
    side: r.side,
    stage: r.stage,
    clientName: r.client_name,
    clientEmail: r.client_email,
    property: r.property_id ? { id: r.property_id, title: r.property_title, slug: r.property_slug } : null,
    agent: r.agent_id ? { id: r.agent_id, name: r.agent_name } : null,
    priceCents: r.price_cents,
    commissionBps: r.commission_bps,
    commissionCents: commissionCents(r.price_cents, r.commission_bps),
    contractDate: r.contract_date,
    closingDate: r.closing_date,
    openTasks: r.open_tasks,
    overdueItems: r.overdue_items,
    nextDue: r.next_due_on ? { label: r.next_due_label, dueOn: r.next_due_on, urgency: urgency(r.next_due_on, false, todayIso()) } : null,
    updatedAt: r.updated_at.toISOString(),
  };
}
export type DealSummary = ReturnType<typeof toDealSummary>;

/** A deterministic plain-language status summary (no AI): what's done, what's next, what's late. */
export function statusSummary(deal: DealSummary, milestones: { label: string; due_on: string | null; completed_at: Date | null }[], tasks: { title: string; due_on: string | null; status: string }[]) {
  const today = todayIso();
  const overdue = [
    ...milestones.filter((m) => !m.completed_at && m.due_on && m.due_on < today).map((m) => `${m.label} (due ${m.due_on})`),
    ...tasks.filter((t) => t.status === "open" && t.due_on && t.due_on < today).map((t) => `${t.title} (due ${t.due_on})`),
  ];
  const done = milestones.filter((m) => m.completed_at).length;
  const lines = [
    `${deal.title} is in "${STAGE_LABEL[deal.stage]}" (${deal.side} side).`,
    `${done} of ${milestones.length} milestones complete; ${deal.openTasks} open task${deal.openTasks === 1 ? "" : "s"}.`,
    deal.nextDue ? `Next: ${deal.nextDue.label} on ${deal.nextDue.dueOn}.` : "No upcoming dated items.",
    overdue.length ? `Overdue: ${overdue.slice(0, 5).join("; ")}.` : "Nothing is overdue.",
  ];
  if (deal.closingDate) lines.push(`Closing is set for ${deal.closingDate}.`);
  return lines.join(" ");
}
