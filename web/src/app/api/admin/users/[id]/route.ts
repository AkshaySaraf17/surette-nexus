import { z } from "zod";
import { hashPassword, requireAdmin } from "@/lib/server/auth";
import { withSystemDb } from "@/lib/server/db";
import { ApiError, assertUuid, handler, notFound, parseBody } from "@/lib/server/http";

const schema = z.object({
  role: z.enum(["admin", "agent", "client"]).optional(),
  isActive: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  assignedAgentId: z.uuid().nullable().optional(),
  newPassword: z.string().min(12, "At least 12 characters.").max(200).refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Include letters and numbers.").optional(),
  unlock: z.boolean().optional(),
});

/**
 * PATCH /api/admin/users/:id — owner/admin account management: role, (de)activation, directory
 * visibility, client's assigned agent, password reset, unlock. Every change is audited.
 * Runs as owner because password and lock columns are hidden from the RLS role; the team
 * check below confines it to the admin's own team.
 */
export const PATCH = handler(async (request: Request, { params }: RouteContext<"/api/admin/users/[id]">) => {
  const { id } = await params;
  assertUuid(id, "User");
  const viewer = await requireAdmin(request);
  const input = await parseBody(request, schema);
  if (id === viewer.id && (input.isActive === false || (input.role && input.role !== "admin"))) {
    throw new ApiError(400, "SELF_LOCKOUT", "You can't deactivate or demote your own account.");
  }
  await withSystemDb(async (db) => {
    const target = await db.one<{ role: string }>("SELECT role::text FROM users WHERE id = $1 AND team_id = $2", [id, viewer.teamId]);
    if (!target) throw notFound("User");
    if (input.role && (input.role === "client") !== (target.role === "client")) throw new ApiError(400, "INVALID_ROLE_CHANGE", "Customer and team accounts can't be converted into each other. Create a new account instead.");
    const hash = input.newPassword ? await hashPassword(input.newPassword) : null;
    await db.query(
      `UPDATE users SET role = coalesce($2::user_role, role), is_active = coalesce($3, is_active),
              is_public = CASE WHEN role = 'client' THEN false ELSE coalesce($4, is_public) END,
              assigned_agent_id = CASE WHEN $5 THEN $6::uuid ELSE assigned_agent_id END,
              password_hash = coalesce($7, password_hash),
              failed_logins = CASE WHEN $8 OR $7 IS NOT NULL THEN 0 ELSE failed_logins END,
              locked_until = CASE WHEN $8 OR $7 IS NOT NULL THEN NULL ELSE locked_until END
        WHERE id = $1`,
      [id, input.role ?? null, input.isActive ?? null, input.isPublic ?? null, input.assignedAgentId !== undefined, input.assignedAgentId ?? null, hash, input.unlock ?? false],
    );
    await db.query("INSERT INTO audit_log (team_id, actor_id, action, entity_type, entity_id, data) VALUES ($1, $2, 'user.updated', 'user', $3, $4)", [
      viewer.teamId,
      viewer.id,
      id,
      { ...input, newPassword: input.newPassword ? "[reset]" : undefined },
    ]);
  });
  return Response.json({ ok: true });
});
