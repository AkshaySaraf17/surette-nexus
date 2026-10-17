import "server-only";
import type { Showing, ShowingStatus, Viewer } from "@/lib/types";
import { withDb, withSystemDb, type DbContext } from "./db";
import { ApiError, notFound } from "./errors";

/**
 * Private showings. Anyone may request a slot for an active listing; the
 * listing agent (or the team leader) confirms it. The database refuses to
 * confirm two overlapping showings for the same property.
 */

export const SHOWING_TIME_ZONE = "America/New_York";
const SLOT_HOURS = [10, 13, 16];
const SLOT_MINUTES = 45;

/** UTC offset (minutes) of `timeZone` at the given instant, e.g. -240 for EDT. */
function offsetMinutes(at: Date, timeZone: string): number {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(part ?? "");
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

/** The instant of local wall-clock time y-m-d h:00 in `timeZone`. */
function zonedTime(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour));
  const offset = offsetMinutes(guess, timeZone);
  const result = new Date(guess.getTime() - offset * 60_000);
  // Re-check across a DST boundary.
  const corrected = offsetMinutes(result, timeZone);
  return corrected === offset ? result : new Date(guess.getTime() - corrected * 60_000);
}

function localDateParts(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", weekday: "short" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), weekday: parts.weekday as string };
}

/** The next `count` open slots (Mon–Sat, 10am/1pm/4pm Eastern) that don't collide with confirmed showings. */
export async function suggestSlots(propertyId: string, count = 3, now = new Date()): Promise<{ startsAt: string; endsAt: string }[]> {
  const booked = await withSystemDb((db) =>
    db.query<{ starts_at: Date; ends_at: Date }>(
      `SELECT starts_at, ends_at FROM showings
        WHERE property_id = $1 AND status = 'confirmed' AND ends_at > now()`,
      [propertyId],
    ),
  );
  const slots: { startsAt: string; endsAt: string }[] = [];
  const earliest = now.getTime() + 18 * 3_600_000; // give the agent time to confirm
  for (let dayOffset = 0; dayOffset < 21 && slots.length < count; dayOffset++) {
    const day = localDateParts(new Date(now.getTime() + dayOffset * 86_400_000), SHOWING_TIME_ZONE);
    if (day.weekday === "Sun") continue;
    for (const hour of SLOT_HOURS) {
      const start = zonedTime(day.year, day.month, day.day, hour, SHOWING_TIME_ZONE);
      const end = new Date(start.getTime() + SLOT_MINUTES * 60_000);
      if (start.getTime() < earliest) continue;
      if (booked.some((b) => b.starts_at < end && b.ends_at > start)) continue;
      slots.push({ startsAt: start.toISOString(), endsAt: end.toISOString() });
      if (slots.length >= count) break;
    }
  }
  return slots;
}

export interface ShowingRequestInput {
  propertyId: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string | null;
  startsAt: string;
  durationMinutes: number;
  notes?: string | null;
  source: "ai_assistant" | "website" | "mobile";
}

/**
 * Record a showing request as the caller (RLS: only for active listings, and only
 * attributed to yourself). Returns ids the caller needs for notifications.
 */
export async function requestShowing(context: DbContext, viewer: Viewer | null, input: ShowingRequestInput) {
  const id = crypto.randomUUID();
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);

  const property = await withDb(context, (db) =>
    db.one<{ id: string; title: string; slug: string; status: string; team_id: string; listing_agent_id: string | null }>(
      "SELECT id, title, slug, status, team_id, listing_agent_id FROM properties WHERE id = $1",
      [input.propertyId],
    ),
  );
  if (!property) throw notFound("Listing");
  if (property.status !== "active") {
    throw new ApiError(409, "NOT_AVAILABLE", "This home isn't available for showings right now.", { propertyId: "Not available." });
  }

  const agentId =
    property.listing_agent_id ??
    (
      await withSystemDb((db) =>
        db.one<{ id: string }>("SELECT id FROM users WHERE team_id = $1 AND is_leader LIMIT 1", [property.team_id]),
      )
    )?.id ??
    null;

  await withDb(context, (db) =>
    db.query(
      `INSERT INTO showings (id, property_id, agent_id, client_user_id, contact_name, contact_email, contact_phone,
                             starts_at, ends_at, status, source, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'requested', $10::showing_source, $11)`,
      [
        id,
        property.id,
        agentId,
        viewer?.id ?? null,
        input.contactName,
        input.contactEmail,
        input.contactPhone ?? null,
        startsAt,
        endsAt,
        input.source,
        input.notes ?? null,
      ],
    ),
  );
  return { id, property, agentId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
}

interface ShowingRow {
  id: string;
  property_id: string;
  property_title: string;
  property_slug: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  starts_at: Date;
  ends_at: Date;
  status: ShowingStatus;
  source: Showing["source"];
  notes: string | null;
  agent_name: string | null;
  created_at: Date;
}

function toShowing(row: ShowingRow): Showing {
  return {
    id: row.id,
    propertyId: row.property_id,
    propertyTitle: row.property_title,
    propertySlug: row.property_slug,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    status: row.status,
    source: row.source,
    notes: row.notes,
    agentName: row.agent_name,
    createdAt: row.created_at.toISOString(),
  };
}

const SHOWING_SELECT = `
  SELECT s.id, s.property_id, p.title AS property_title, p.slug AS property_slug, s.contact_name, s.contact_email,
         s.contact_phone, s.starts_at, s.ends_at, s.status, s.source, s.notes, a.full_name AS agent_name, s.created_at
    FROM showings s
    JOIN properties p ON p.id = s.property_id
    LEFT JOIN users a ON a.id = s.agent_id`;

/** Showings visible to the caller (staff: their team's; clients: their own), upcoming first. */
export async function listShowings(context: DbContext, options: { includePast?: boolean } = {}): Promise<Showing[]> {
  const rows = await withDb(context, (db) =>
    db.query<ShowingRow>(
      `${SHOWING_SELECT}
        ${options.includePast ? "" : "WHERE s.ends_at > now() - interval '1 day'"}
        ORDER BY s.starts_at ASC
        LIMIT 200`,
    ),
  );
  return rows.map(toShowing);
}

export async function updateShowing(context: DbContext, id: string, status: ShowingStatus, notes?: string | null): Promise<Showing> {
  return withDb(context, async (db) => {
    const updated = await db.query(
      `UPDATE showings SET status = $2::showing_status, notes = COALESCE($3, notes) WHERE id = $1 RETURNING id`,
      [id, status, notes ?? null],
    );
    if (updated.length === 0) throw notFound("Showing");
    const row = await db.one<ShowingRow>(`${SHOWING_SELECT} WHERE s.id = $1`, [id]);
    return toShowing(row!);
  });
}

export function formatShowingTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SHOWING_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
