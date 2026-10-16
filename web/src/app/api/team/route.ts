import { hashPassword, requireStaff } from "@/lib/server/auth";
import { withSystemDb } from "@/lib/server/db";
import { ApiError, handler, parseBody } from "@/lib/server/http";
import { getSiteTeam, listTeamMembers } from "@/lib/server/listings";
import { teamMemberSchema } from "@/lib/validation";

/** GET /api/team — the public team directory (leader first) and office details. */
export const GET = handler(async () => {
  const [team, members] = await Promise.all([getSiteTeam(), listTeamMembers()]);
  return Response.json({ team, members });
});

/** POST /api/team — admins add a team member (agent or admin) with a starting password. */
export const POST = handler(async (request: Request) => {
  const viewer = await requireStaff(request);
  if (viewer.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Only admins can add team members.");
  const input = await parseBody(request, teamMemberSchema);
  const passwordHash = await hashPassword(input.password);
  // Runs as owner because password_hash is invisible to the RLS role; the admin check above guards it.
  const row = await withSystemDb((db) =>
    db.one<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name, phone, role, team_id, title, bio, photo_url, specialties, is_public, sort_order)
       VALUES ($1, $2, $3, $4, $5::user_role, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [
        input.email,
        passwordHash,
        input.fullName,
        input.phone ?? null,
        input.role,
        viewer.teamId,
        input.title,
        input.bio ?? null,
        input.photoUrl ?? null,
        input.specialties,
        input.isPublic,
        input.sortOrder,
      ],
    ),
  );
  return Response.json({ id: row!.id, members: await listTeamMembers() }, { status: 201 });
});
