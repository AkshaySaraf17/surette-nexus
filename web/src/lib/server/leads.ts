import "server-only";
import { CONTACT_CONSENT_TEXT, CONTACT_CONSENT_VERSION } from "@/lib/privacy";
import { withSystemDb } from "./db";
import { getSiteTeam } from "./listings";
import { publishEvent } from "./events";

/**
 * Lead intake. Leads are created only after a person explicitly asks for help
 * (contact form, showing request, AI assistant hand-off, Dual-Move "send to agent")
 * and ticks the contact-consent box. Anonymous browsing is never attached.
 *
 * Duplicate protection: the same email (or phone) asking about the same property
 * (or with no property) within 24 hours adds a note to the existing lead instead of
 * creating another one, so agents don't receive duplicate leads.
 */

export type LeadSource = "ai_assistant" | "contact_form" | "showing_request" | "dual_move" | "signup" | "manual" | "import";

export interface LeadInput {
  source: LeadSource;
  contactName: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  message?: string | null;
  propertyId?: string | null;
  clientUserId?: string | null;
  preferences?: Record<string, unknown>;
  summary?: string | null;
}

export async function createLead(input: LeadInput): Promise<{ id: string; duplicate: boolean; assignedAgentId: string | null }> {
  const team = await getSiteTeam();
  const result = await withSystemDb(async (db) => {
    const existing = await db.one<{ id: string; assigned_agent_id: string | null }>(
      `SELECT id, assigned_agent_id FROM leads
        WHERE team_id = $1 AND created_at > now() - interval '24 hours'
          AND ((contact_email IS NOT NULL AND contact_email = $2) OR (contact_phone IS NOT NULL AND contact_phone = $3))
          AND property_id IS NOT DISTINCT FROM $4
        ORDER BY created_at DESC LIMIT 1`,
      [team.id, input.contactEmail ?? null, input.contactPhone ?? null, input.propertyId ?? null],
    );
    if (existing) {
      await db.query("INSERT INTO lead_notes (lead_id, body) VALUES ($1, $2)", [
        existing.id,
        `Follow-up via ${input.source.replace("_", " ")}${input.message ? `: ${input.message.slice(0, 1500)}` : ""}`,
      ]);
      await db.query("UPDATE leads SET updated_at = now() WHERE id = $1", [existing.id]);
      return { id: existing.id, duplicate: true, assignedAgentId: existing.assigned_agent_id };
    }
    // Route to the listing agent when the request is about a home; otherwise to the client's agent or the team leader.
    const agent = await db.one<{ id: string }>(
      `SELECT coalesce(
         (SELECT listing_agent_id FROM properties WHERE id = $2),
         (SELECT assigned_agent_id FROM users WHERE id = $3),
         (SELECT id FROM users WHERE team_id = $1 AND is_leader LIMIT 1)) AS id`,
      [team.id, input.propertyId ?? null, input.clientUserId ?? null],
    );
    const lead = await db.one<{ id: string }>(
      `INSERT INTO leads (team_id, source, contact_name, contact_email, contact_phone, message, preferences, summary, property_id,
                          assigned_agent_id, client_user_id, consent_contact, consent_text)
       VALUES ($1, $2::lead_source, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, $12) RETURNING id`,
      [
        team.id,
        input.source,
        input.contactName,
        input.contactEmail ?? null,
        input.contactPhone ?? null,
        input.message ?? null,
        input.preferences ?? {},
        input.summary ?? null,
        input.propertyId ?? null,
        agent?.id ?? null,
        input.clientUserId ?? null,
        CONTACT_CONSENT_TEXT,
      ],
    );
    await db.query("INSERT INTO consent_records (team_id, lead_id, user_id, purpose, granted, text_version) VALUES ($1, $2, $3, 'contact', true, $4)", [
      team.id,
      lead!.id,
      input.clientUserId ?? null,
      CONTACT_CONSENT_VERSION,
    ]);
    // Transactional outbox: the event commits with the lead, or not at all.
    await publishEvent(db, { type: "lead.created", teamId: team.id, aggregate: "lead", aggregateId: lead!.id, payload: { leadId: lead!.id, source: input.source, propertyId: input.propertyId ?? null, assignedAgentId: agent?.id ?? null } });
    return { id: lead!.id, duplicate: false, assignedAgentId: agent?.id ?? null };
  });
  return result;
}

export const LEAD_SELECT = `
  SELECT l.id, l.source, l.status, l.contact_name, l.contact_email, l.contact_phone, l.message, l.preferences, l.summary,
         l.property_id, p.title AS property_title, p.slug AS property_slug, l.assigned_agent_id, a.full_name AS agent_name,
         l.client_user_id, l.next_follow_up_on, l.created_at, l.updated_at,
         (SELECT count(*)::int FROM lead_notes n WHERE n.lead_id = l.id) AS note_count,
         (SELECT t.id FROM transactions t WHERE t.lead_id = l.id ORDER BY t.created_at DESC LIMIT 1) AS transaction_id
    FROM leads l
    LEFT JOIN properties p ON p.id = l.property_id
    LEFT JOIN users a ON a.id = l.assigned_agent_id`;

export interface LeadRow {
  id: string;
  source: LeadSource;
  status: string;
  contact_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  message: string | null;
  preferences: Record<string, unknown>;
  summary: string | null;
  property_id: string | null;
  property_title: string | null;
  property_slug: string | null;
  assigned_agent_id: string | null;
  agent_name: string | null;
  client_user_id: string | null;
  next_follow_up_on: string | null;
  created_at: Date;
  updated_at: Date;
  note_count: number;
  transaction_id: string | null;
}

export function toLead(r: LeadRow) {
  return {
    id: r.id,
    source: r.source,
    status: r.status,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    message: r.message,
    preferences: r.preferences,
    summary: r.summary,
    property: r.property_id ? { id: r.property_id, title: r.property_title, slug: r.property_slug } : null,
    agent: r.assigned_agent_id ? { id: r.assigned_agent_id, name: r.agent_name } : null,
    clientUserId: r.client_user_id,
    nextFollowUpOn: r.next_follow_up_on,
    noteCount: r.note_count,
    transactionId: r.transaction_id,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}
