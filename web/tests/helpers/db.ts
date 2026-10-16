import { withSystemDb } from "@/lib/server/db";

/** Shared helpers for database-backed tests (local Postgres from .env; see scripts/db.sh). */
export const testTag = (prefix = "t") => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function siteTeamId(): Promise<string> {
  const row = await withSystemDb((db) => db.one<{ id: string }>("SELECT id FROM agent_teams WHERE slug = 'surette'"));
  if (!row) throw new Error("Seed data missing — run npm run db:seed");
  return row.id;
}
