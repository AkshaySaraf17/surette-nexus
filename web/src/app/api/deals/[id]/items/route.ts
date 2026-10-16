import { z } from "zod";
import { contextFor, requireStaff } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { assertUuid, handler, notFound, parseBody } from "@/lib/server/http";

/** Milestones and tasks of a deal: create, complete/reopen, reschedule, reassign, delete. */
const createSchema = z.object({
  kind: z.enum(["task", "milestone"]),
  title: z.string().trim().min(1, "Describe the item.").max(200),
  dueOn: z.iso.date().nullable().optional(),
  assigneeId: z.uuid().nullable().optional(),
  clientVisible: z.boolean().default(false),
});
const patchSchema = z.object({
  kind: z.enum(["task", "milestone"]),
  itemId: z.uuid(),
  done: z.boolean().optional(),
  dueOn: z.iso.date().nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  assigneeId: z.uuid().nullable().optional(),
});

async function log(db: import("@/lib/server/db").Db, viewer: { id: string; teamId: string }, dealId: string, action: string, data: Record<string, unknown>) {
  await db.query("INSERT INTO audit_log (team_id, actor_id, action, entity_type, entity_id, data) VALUES ($1, $2, $3, 'transaction', $4, $5)", [viewer.teamId, viewer.id, action, dealId, data]);
}

export const POST = handler(async (request: Request, { params }: RouteContext<"/api/deals/[id]/items">) => {
  const { id } = await params;
  assertUuid(id, "Deal");
  const viewer = await requireStaff(request);
  const input = await parseBody(request, createSchema);
  await withDb(contextFor(viewer), async (db) => {
    if (!(await db.one("SELECT 1 FROM transactions WHERE id = $1", [id]))) throw notFound("Deal");
    if (input.kind === "task") {
      await db.query("INSERT INTO transaction_tasks (transaction_id, title, due_on, assignee_id) VALUES ($1, $2, $3, $4)", [id, input.title, input.dueOn ?? null, input.assigneeId ?? viewer.id]);
    } else {
      await db.query("INSERT INTO transaction_milestones (transaction_id, label, due_on, sort_order, client_visible) VALUES ($1, $2, $3, 999, $4)", [id, input.title, input.dueOn ?? null, input.clientVisible]);
    }
    await log(db, viewer, id, `${input.kind}.added`, { title: input.title, dueOn: input.dueOn ?? null });
  });
  return Response.json({ ok: true }, { status: 201 });
});

export const PATCH = handler(async (request: Request, { params }: RouteContext<"/api/deals/[id]/items">) => {
  const { id } = await params;
  assertUuid(id, "Deal");
  const viewer = await requireStaff(request);
  const input = await parseBody(request, patchSchema);
  await withDb(contextFor(viewer), async (db) => {
    const table = input.kind === "task" ? "transaction_tasks" : "transaction_milestones";
    const titleCol = input.kind === "task" ? "title" : "label";
    const sets: string[] = [];
    const values: unknown[] = [input.itemId, id];
    const push = (sql: string, v: unknown) => {
      values.push(v);
      sets.push(sql.replace("?", `$${values.length}`));
    };
    if (input.done !== undefined) {
      if (input.kind === "task") {
        push("status = ?::task_status", input.done ? "done" : "open");
        sets.push(input.done ? "completed_at = now()" : "completed_at = NULL");
      } else sets.push(input.done ? "completed_at = now()" : "completed_at = NULL");
    }
    // A manual reschedule detaches the item from its template rule so key-date changes won't move it back.
    if (input.dueOn !== undefined) {
      push("due_on = ?", input.dueOn);
      if (input.kind === "milestone") sets.push("rule = NULL");
    }
    if (input.title !== undefined) push(`${titleCol} = ?`, input.title);
    if (input.assigneeId !== undefined && input.kind === "task") push("assignee_id = ?", input.assigneeId);
    if (!sets.length) return;
    const rows = await db.query(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = $1 AND transaction_id = $2 RETURNING id`, values);
    if (!rows.length) throw notFound("Item");
    await log(db, viewer, id, input.done === true ? `${input.kind}.completed` : input.done === false ? `${input.kind}.reopened` : `${input.kind}.updated`, { itemId: input.itemId, dueOn: input.dueOn });
  });
  return Response.json({ ok: true });
});

export const DELETE = handler(async (request: Request, { params }: RouteContext<"/api/deals/[id]/items">) => {
  const { id } = await params;
  assertUuid(id, "Deal");
  const viewer = await requireStaff(request);
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "milestone" ? "transaction_milestones" : "transaction_tasks";
  const itemId = url.searchParams.get("itemId") ?? "";
  assertUuid(itemId, "Item");
  await withDb(contextFor(viewer), async (db) => {
    const rows = await db.query(`DELETE FROM ${kind} WHERE id = $1 AND transaction_id = $2 RETURNING id`, [itemId, id]);
    if (!rows.length) throw notFound("Item");
    await log(db, viewer, id, "item.deleted", { itemId });
  });
  return new Response(null, { status: 204 });
});
