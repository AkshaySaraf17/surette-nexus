import "server-only";
import { STAGE_LABEL } from "@/lib/deal-rules";
import type { Viewer } from "@/lib/types";
import { complete } from "./ai";
import { contextFor } from "./auth";
import { withDb } from "./db";
import { notFound } from "./errors";

/**
 * Communication drafts. Templates produce the draft deterministically; local AI (if
 * available and requested) may only rephrase it, and its version is accepted only if it
 * keeps every date and amount from the template. Drafts are never sent automatically:
 * a person approves, then sends from their own mail app and marks it sent.
 */

export type DraftKind = "status_update" | "deadline_reminder" | "document_request";

const fmt = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

export async function generateDealDraft(viewer: Viewer & { teamId: string }, dealId: string, kind: DraftKind, itemId: string | null, useAi: boolean) {
  const ctx = contextFor(viewer);
  const data = await withDb(ctx, async (db) => {
    const deal = await db.one<{ title: string; stage: keyof typeof STAGE_LABEL; client_name: string; client_email: string | null; closing_date: string | null; property: string | null }>(
      "SELECT t.title, t.stage, t.client_name, t.client_email, t.closing_date, p.address_line || ', ' || p.city AS property FROM transactions t LEFT JOIN properties p ON p.id = t.property_id WHERE t.id = $1",
      [dealId],
    );
    if (!deal) throw notFound("Deal");
    const upcoming = await db.query<{ label: string; due_on: string }>(
      "SELECT label, due_on FROM transaction_milestones WHERE transaction_id = $1 AND completed_at IS NULL AND due_on IS NOT NULL AND client_visible ORDER BY due_on LIMIT 4",
      [dealId],
    );
    const item = itemId
      ? (await db.one<{ label: string; due_on: string | null }>("SELECT label, due_on FROM transaction_milestones WHERE id = $1 AND transaction_id = $2", [itemId, dealId])) ??
        (await db.one<{ label: string; due_on: string | null }>("SELECT title AS label, due_on FROM transaction_tasks WHERE id = $1 AND transaction_id = $2", [itemId, dealId]))
      : null;
    return { deal, upcoming, item };
  });

  const first = data.deal.client_name.split(" ")[0];
  const where = data.deal.property ? ` for ${data.deal.property}` : "";
  let subject: string;
  let body: string;
  if (kind === "deadline_reminder" && data.item) {
    subject = `Reminder: ${data.item.label}${data.item.due_on ? ` — ${fmt(data.item.due_on)}` : ""}`;
    body = [
      `Hi ${first},`,
      "",
      `A quick reminder about an upcoming step${where}: ${data.item.label}${data.item.due_on ? `, due ${fmt(data.item.due_on)}` : ""}.`,
      "",
      "Let me know if anything could get in the way, or if you have questions.",
      "",
      `Best,`,
      viewer.fullName,
      "Surette Real Estate",
    ].join("\n");
  } else if (kind === "document_request") {
    subject = `Documents needed${where}`;
    body = [`Hi ${first},`, "", `To keep things moving${where}, could you send over the documents we discussed? You can reply to this email with attachments.`, "", "Thank you,", viewer.fullName, "Surette Real Estate"].join("\n");
  } else {
    subject = `Update${where}: ${STAGE_LABEL[data.deal.stage]}`;
    const lines = data.upcoming.map((u) => `• ${u.label} — ${fmt(u.due_on)}`);
    body = [
      `Hi ${first},`,
      "",
      `Here's where things stand${where}: we're at the "${STAGE_LABEL[data.deal.stage]}" stage.`,
      ...(lines.length ? ["", "Coming up:", ...lines] : []),
      ...(data.deal.closing_date ? ["", `Closing is currently scheduled for ${fmt(data.deal.closing_date)}.`] : []),
      "",
      "I'll keep you posted as each step is completed.",
      "",
      "Best,",
      viewer.fullName,
      "Surette Real Estate",
    ].join("\n");
  }

  let aiGenerated = false;
  if (useAi) {
    const polished = await complete(
      [
        { role: "system", content: "Rewrite the real-estate client email below to be warm and concise. Keep every date, name and fact exactly as written. Do not add facts, promises, legal or financial advice. Return only the email body." },
        { role: "user", content: body },
      ],
      { temperature: 0.4, maxTokens: 400 },
    );
    const mustKeep = [...body.matchAll(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), [A-Z][a-z]+ \d{1,2}, \d{4}/g)].map((m) => m[0]);
    if (polished && mustKeep.every((d) => polished.text.includes(d))) {
      body = polished.text;
      aiGenerated = true;
    }
  }

  const draft = await withDb(ctx, (db) =>
    db.one<{ id: string }>(
      "INSERT INTO communication_drafts (team_id, transaction_id, to_email, subject, body, ai_generated, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [viewer.teamId, dealId, data.deal.client_email, subject, body, aiGenerated, viewer.id],
    ),
  );
  return { id: draft!.id, subject, body, aiGenerated };
}

export function mailtoLink(to: string | null, subject: string, body: string) {
  return `mailto:${encodeURIComponent(to ?? "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
