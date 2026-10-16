import { connection } from "next/server";
import { z } from "zod";
import { EVENT_RULES, cleanProps } from "@/lib/analytics-events";
import { withSystemDb } from "@/lib/server/db";
import { ApiError, rateLimit } from "@/lib/server/http";
import { metrics } from "@/lib/server/metrics";

/**
 * POST /api/analytics/collect — the ingestion endpoint used by the browser SDK.
 *
 * Pipeline: size limit → JSON parse → project lookup → origin check (per-project allow-list)
 * → rate limit → per-event schema validation → property allow-listing → clock clamping →
 * insert (duplicate event_ids ignored). Responds 204 even when individual events are
 * dropped, so a misbehaving page never breaks; malformed batches get 400.
 *
 * The data class (production / synthetic / test) comes from the project row, never from
 * the client, so nobody can inject "production" data through the demo project or vice versa.
 */

const MAX_BODY_BYTES = 32 * 1024;
const MAX_EVENTS = 25;
const ID = /^[A-Za-z0-9_-]{8,40}$/;

const eventSchema = z.object({
  event_id: z.uuid(),
  type: z.string().regex(/^[a-z_]{3,40}$/),
  occurred_at: z.iso.datetime({ offset: true }),
  session_id: z.string().regex(ID),
  visitor_id: z.string().regex(ID).nullable().optional(),
  path: z.string().max(300).regex(/^\//),
  referrer_domain: z.string().max(120).regex(/^[a-z0-9.-]+$/i).nullable().optional(),
  utm: z.record(z.string(), z.string().max(80)).optional(),
  device: z.enum(["desktop", "mobile", "tablet", "other"]).optional(),
  props: z.record(z.string(), z.unknown()).optional(),
});
const batchSchema = z.object({
  project: z.string().regex(/^[a-z0-9-]{3,40}$/),
  consent: z.enum(["granted", "denied", "unset"]).optional(),
  events: z.array(z.unknown()).min(1).max(MAX_EVENTS),
});

type Project = { key: string; data_class: string; allowed_origins: string[]; enabled_categories: string[] };

function cors(origin: string | null, allowed: boolean): Record<string, string> {
  if (!origin || !allowed) return {};
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" };
}

function originAllowed(request: Request, project: Project | null, origin: string | null): boolean {
  if (!origin) return true; // sendBeacon from same-origin pages may omit Origin; no credentials are used.
  const self = new URL(request.url).origin;
  if (origin === self) return true;
  return Boolean(project?.allowed_origins.includes(origin));
}

const projectCache = new Map<string, { project: Project | null; at: number }>();
async function getProject(key: string): Promise<Project | null> {
  const cached = projectCache.get(key);
  if (cached && Date.now() - cached.at < 60_000) return cached.project;
  const project = await withSystemDb((db) =>
    db.one<Project>("SELECT key, data_class, allowed_origins, enabled_categories FROM analytics_projects WHERE key = $1", [key]),
  );
  projectCache.set(key, { project, at: Date.now() });
  return project;
}

export async function OPTIONS(request: Request) {
  await connection();
  const origin = request.headers.get("origin");
  // Preflights don't carry the body (project), so allow any configured origin across projects.
  const known = origin
    ? await withSystemDb((db) => db.one("SELECT 1 FROM analytics_projects WHERE $1 = ANY(allowed_origins)", [origin]))
    : null;
  const allowed = Boolean(origin && (known || origin === new URL(request.url).origin));
  return new Response(null, { status: 204, headers: cors(origin, allowed) });
}

export async function POST(request: Request) {
  await connection();
  const origin = request.headers.get("origin");
  try {
    await rateLimit(request, "analytics", 240, 60_000);
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > MAX_BODY_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Batch too large.");
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Batch too large.");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ApiError(400, "INVALID_JSON", "Body must be JSON.");
    }
    const batch = batchSchema.safeParse(raw);
    if (!batch.success) throw new ApiError(400, "INVALID_BATCH", "Malformed analytics batch.");
    const project = await getProject(batch.data.project);
    const allowed = originAllowed(request, project, origin);
    if (!project) throw new ApiError(404, "UNKNOWN_PROJECT", "Unknown analytics project.");
    if (!allowed) return Response.json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "Origin not allowed for this project." } }, { status: 403 });
    if (batch.data.consent === "denied") return new Response(null, { status: 204, headers: cors(origin, allowed) });

    const now = Date.now();
    const rows: unknown[][] = [];
    let rejected = 0;
    for (const candidate of batch.data.events) {
      const parsed = eventSchema.safeParse(candidate);
      if (!parsed.success || !EVENT_RULES[parsed.data.type]) {
        rejected++;
        continue;
      }
      const e = parsed.data;
      const rule = EVENT_RULES[e.type];
      if (!project.enabled_categories.includes(rule.category)) continue;
      const occurred = new Date(e.occurred_at).getTime();
      // Real browsers report "now"; clamp skewed clocks. Synthetic (demo) projects may backfill up to 45 days.
      const maxAgeMs = project.data_class === "synthetic" ? 45 * 86_400_000 : 24 * 3_600_000;
      const occurredAt = occurred > now + 5 * 60_000 || occurred < now - maxAgeMs ? new Date(now) : new Date(occurred);
      const { props, propertyId } = cleanProps(e.type, e.props);
      const utm = e.utm ?? {};
      rows.push([
        e.event_id,
        project.key,
        project.data_class,
        e.type,
        rule.category,
        occurredAt,
        e.session_id,
        e.visitor_id ?? null,
        e.path.split("?")[0].split("#")[0],
        e.referrer_domain?.toLowerCase() ?? null,
        utm.source ?? null,
        utm.medium ?? null,
        utm.campaign ?? null,
        utm.content ?? null,
        utm.term ?? null,
        e.device ?? "other",
        propertyId,
        props,
      ]);
    }
    if (rows.length) {
      const cols = 18;
      const values = rows.flat();
      const placeholders = rows.map((_, r) => `(${Array.from({ length: cols }, (_, c) => `$${r * cols + c + 1}${c === 2 ? "::data_class" : ""}`).join(",")})`).join(",");
      await withSystemDb((db) =>
        db.query(
          `INSERT INTO analytics_events (event_id, project_key, data_class, type, category, occurred_at, session_id, visitor_id, path,
             referrer_domain, utm_source, utm_medium, utm_campaign, utm_content, utm_term, device, property_id, props)
           VALUES ${placeholders} ON CONFLICT (event_id) DO NOTHING`,
          values,
        ),
      );
    }
    if (rows.length) metrics.analyticsEvents.inc({ project: project.key, result: "accepted" }, rows.length);
    if (rejected) metrics.analyticsEvents.inc({ project: project.key, result: "rejected" }, rejected);
    return new Response(null, { status: rejected && !rows.length ? 400 : 204, headers: { ...cors(origin, allowed), "X-Events-Accepted": String(rows.length), "X-Events-Rejected": String(rejected) } });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    if (!(error instanceof ApiError)) console.error("[analytics] collect failed", error);
    return Response.json(
      { error: { code: error instanceof ApiError ? error.code : "INTERNAL_ERROR", message: error instanceof ApiError ? error.message : "Collector error." } },
      { status, headers: cors(origin, true) },
    );
  }
}
