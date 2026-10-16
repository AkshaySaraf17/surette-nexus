import "server-only";
import { CONVERSION_EVENTS, EVENT_RULES, FUNNEL_STAGES } from "@/lib/analytics-events";
import { withDb, withSystemDb, type DbContext } from "./db";

/**
 * Analytics aggregation. Every number comes from rows in analytics_events.
 *
 * Definitions (also shown on the dashboard):
 *  - Page views: count of page_view events.
 *  - Sessions: distinct session_id. The SDK starts a new session after 30 minutes of
 *    inactivity or in a new browser tab.
 *  - Visitors: distinct visitor_id where the visitor granted consent (persistent id),
 *    otherwise each session counts as one visitor. So "visitors" is an upper bound.
 *  - Returning visitors: consenting visitors whose first event is before the range, or
 *    who had 2+ sessions in the range.
 *  - Landing / exit page: the first / last page_view path of each session.
 *  - Engaged time: sum of page_engagement seconds (time the tab was visible) ÷ sessions.
 *  - Funnel: a session reaches a stage if it fired any of that stage's events and also
 *    reached every earlier stage. Stage rate = stage sessions ÷ previous stage sessions.
 * Limitations: ad blockers, consent choices, private browsing and network failures
 * mean these are lower bounds of real activity, not exact counts.
 */

export interface Range {
  from: Date;
  to: Date;
  classes: ("production" | "synthetic" | "test")[];
}

const FILTER = "e.occurred_at >= $1 AND e.occurred_at < $2 AND e.data_class = ANY($3::data_class[])";
const args = (r: Range) => [r.from, r.to, r.classes];

export function parseRange(url: URL): Range {
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? "30") || 30, 1), 400);
  const to = url.searchParams.get("to") ? new Date(`${url.searchParams.get("to")}T23:59:59.999Z`) : new Date();
  const from = url.searchParams.get("from") ? new Date(`${url.searchParams.get("from")}T00:00:00Z`) : new Date(to.getTime() - days * 86_400_000);
  const requested = (url.searchParams.get("classes") ?? "production").split(",");
  const classes = requested.filter((c): c is Range["classes"][number] => ["production", "synthetic", "test"].includes(c));
  return { from, to, classes: classes.length ? classes : ["production"] };
}

export async function overview(ctx: DbContext, r: Range) {
  return withDb(ctx, async (db) => {
    const totals = await db.one<{ page_views: number; sessions: number; visitors: number; consented_visitors: number; engaged_seconds: number; events: number }>(
      `SELECT count(*) FILTER (WHERE type = 'page_view')::int AS page_views,
              count(DISTINCT session_id)::int AS sessions,
              count(DISTINCT coalesce(visitor_id, 's:' || session_id))::int AS visitors,
              count(DISTINCT visitor_id)::int AS consented_visitors,
              coalesce(sum((props->>'seconds')::int) FILTER (WHERE type = 'page_engagement'), 0)::int AS engaged_seconds,
              count(*)::int AS events
         FROM analytics_events e WHERE ${FILTER}`,
      args(r),
    );
    const returning = await db.one<{ returning: number }>(
      `WITH v AS (
         SELECT visitor_id, count(DISTINCT session_id) AS sessions FROM analytics_events e
          WHERE ${FILTER} AND visitor_id IS NOT NULL GROUP BY visitor_id)
       SELECT count(*)::int AS returning FROM v
        WHERE v.sessions > 1 OR EXISTS (
          SELECT 1 FROM analytics_events p WHERE p.visitor_id = v.visitor_id AND p.occurred_at < $1 AND p.data_class = ANY($3::data_class[]))`,
      args(r),
    );
    const daily = await db.query<{ day: string; page_views: number; sessions: number; conversions: number }>(
      `SELECT to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS day,
              count(*) FILTER (WHERE type = 'page_view')::int AS page_views,
              count(DISTINCT session_id)::int AS sessions,
              count(*) FILTER (WHERE type = ANY($4))::int AS conversions
         FROM analytics_events e WHERE ${FILTER} GROUP BY 1 ORDER BY 1`,
      [...args(r), CONVERSION_EVENTS],
    );
    const pages = await db.query<{ path: string; views: number; sessions: number }>(
      `SELECT path, count(*)::int AS views, count(DISTINCT session_id)::int AS sessions
         FROM analytics_events e WHERE ${FILTER} AND type = 'page_view' GROUP BY path ORDER BY views DESC LIMIT 12`,
      args(r),
    );
    const landingExit = await db.query<{ kind: string; path: string; sessions: number }>(
      `WITH pv AS (
         SELECT session_id, path,
                row_number() OVER (PARTITION BY session_id ORDER BY occurred_at ASC) AS first_rank,
                row_number() OVER (PARTITION BY session_id ORDER BY occurred_at DESC) AS last_rank
           FROM analytics_events e WHERE ${FILTER} AND type = 'page_view')
       SELECT 'landing' AS kind, path, count(*)::int AS sessions FROM pv WHERE first_rank = 1 GROUP BY path
       UNION ALL
       SELECT 'exit' AS kind, path, count(*)::int AS sessions FROM pv WHERE last_rank = 1 GROUP BY path
       ORDER BY sessions DESC`,
      args(r),
    );
    const sources = await db.query<{ source: string; sessions: number; conversions: number }>(
      `WITH s AS (
         SELECT session_id,
                coalesce(max(utm_source), max(referrer_domain), '(direct)') AS source,
                bool_or(type = ANY($4)) AS converted
           FROM analytics_events e WHERE ${FILTER} GROUP BY session_id)
       SELECT source, count(*)::int AS sessions, count(*) FILTER (WHERE converted)::int AS conversions
         FROM s GROUP BY source ORDER BY sessions DESC LIMIT 12`,
      [...args(r), CONVERSION_EVENTS],
    );
    const campaigns = await db.query<{ campaign: string; source: string | null; medium: string | null; sessions: number; property_views: number; conversions: number }>(
      `WITH s AS (
         SELECT session_id, max(utm_campaign) AS campaign, max(utm_source) AS source, max(utm_medium) AS medium,
                count(*) FILTER (WHERE type = 'property_view') AS property_views,
                bool_or(type = ANY($4)) AS converted
           FROM analytics_events e WHERE ${FILTER} GROUP BY session_id)
       SELECT campaign, source, medium, count(*)::int AS sessions, sum(property_views)::int AS property_views,
              count(*) FILTER (WHERE converted)::int AS conversions
         FROM s WHERE campaign IS NOT NULL GROUP BY campaign, source, medium ORDER BY sessions DESC LIMIT 20`,
      [...args(r), CONVERSION_EVENTS],
    );
    const devices = await db.query<{ device: string; sessions: number }>(
      `SELECT coalesce(device, 'other') AS device, count(DISTINCT session_id)::int AS sessions
         FROM analytics_events e WHERE ${FILTER} GROUP BY 1 ORDER BY 2 DESC`,
      args(r),
    );
    const scroll = await db.query<{ depth: number; sessions: number }>(
      `SELECT (props->>'depth')::int AS depth, count(DISTINCT session_id)::int AS sessions
         FROM analytics_events e WHERE ${FILTER} AND type = 'scroll_depth' GROUP BY 1 ORDER BY 1`,
      args(r),
    );
    return {
      totals: { ...totals!, returning_visitors: returning?.returning ?? 0 },
      daily,
      pages,
      landing: landingExit.filter((x) => x.kind === "landing").slice(0, 8),
      exits: landingExit.filter((x) => x.kind === "exit").slice(0, 8),
      sources,
      campaigns,
      devices,
      scroll,
    };
  });
}

export async function funnel(ctx: DbContext, r: Range) {
  return withDb(ctx, async (db) => {
    const rows = await db.query<Record<string, boolean>>(
      `SELECT session_id, ${FUNNEL_STAGES.map((s, i) => `bool_or(type = ANY($${4 + i})) AS "${s.key}"`).join(", ")}
         FROM analytics_events e WHERE ${FILTER} GROUP BY session_id`,
      [...args(r), ...FUNNEL_STAGES.map((s) => s.events)],
    );
    // Ordered funnel: a session counts at stage k only if it reached stages 0..k.
    const counts = FUNNEL_STAGES.map(() => 0);
    for (const row of rows) {
      for (let k = 0; k < FUNNEL_STAGES.length; k++) {
        if (!row[FUNNEL_STAGES[k].key]) break;
        counts[k]++;
      }
    }
    return FUNNEL_STAGES.map((s, k) => ({
      key: s.key,
      label: s.label,
      events: s.events,
      sessions: counts[k],
      denominator: k === 0 ? counts[0] : counts[k - 1],
      rate: k === 0 ? (counts[0] ? 1 : 0) : counts[k - 1] ? counts[k] / counts[k - 1] : 0,
      dropOff: k === 0 ? 0 : counts[k - 1] - counts[k],
    }));
  });
}

export async function journeys(ctx: DbContext, r: Range) {
  return withDb(ctx, async (db) => {
    // The first four distinct page types/paths of each session, collapsed into a path string.
    return db.query<{ journey: string; sessions: number; converted: number }>(
      `WITH steps AS (
         SELECT session_id, occurred_at,
                CASE WHEN type = 'property_view' THEN 'Property detail'
                     WHEN type = 'search_submit' THEN 'Search'
                     WHEN type = ANY($4) THEN 'Contact submitted'
                     WHEN type IN ('form_start', 'showing_request_start', 'phone_click', 'email_click') THEN 'Contact action'
                     WHEN type = 'agent_profile_view' THEN 'Agent profile'
                     WHEN type = 'page_view' AND path = '/' THEN 'Home'
                     WHEN type = 'page_view' AND path LIKE '/listings/%' THEN NULL
                     WHEN type = 'page_view' AND path LIKE '/listings%' THEN 'Listings'
                     WHEN type = 'page_view' THEN initcap(split_part(trim(leading '/' from path), '/', 1))
                END AS step
           FROM analytics_events e WHERE ${FILTER}),
       dedup AS (
         SELECT session_id, step, occurred_at, lag(step) OVER (PARTITION BY session_id ORDER BY occurred_at) AS prev
           FROM steps WHERE step IS NOT NULL),
       seq AS (
         SELECT session_id, array_agg(step ORDER BY occurred_at) AS path
           FROM dedup WHERE prev IS DISTINCT FROM step GROUP BY session_id)
       SELECT array_to_string(path[1:5], ' → ') AS journey, count(*)::int AS sessions,
              count(*) FILTER (WHERE 'Contact submitted' = ANY(path))::int AS converted
         FROM seq GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
      [...args(r), CONVERSION_EVENTS],
    );
  });
}

/** `ctx` "system" is used only for the agent view, which is always scoped to that agent's own listing ids. */
export async function propertyEngagement(ctx: DbContext | "system", r: Range, propertyIds?: string[]) {
  const scope = propertyIds ? "AND e.property_id = ANY($4::uuid[])" : "";
  const params = propertyIds ? [...args(r), propertyIds] : args(r);
  const run = <T extends Record<string, unknown>>(sql: string) =>
    ctx === "system" ? withSystemDb((db) => db.query<T>(sql, params)) : withDb(ctx, (db) => db.query<T>(sql, params));
  const [top, filters, priceBands, contacted, daily] = await Promise.all([
    run<{ property_id: string; title: string | null; city: string | null; views: number; card_clicks: number; saves: number; showing_requests: number }>(
      `SELECT e.property_id, p.title, p.city,
              count(*) FILTER (WHERE e.type = 'property_view')::int AS views,
              count(*) FILTER (WHERE e.type = 'property_card_click')::int AS card_clicks,
              count(*) FILTER (WHERE e.type = 'property_save' AND (e.props->>'saved')::boolean)::int AS saves,
              count(*) FILTER (WHERE e.type = 'showing_request_submit')::int AS showing_requests
         FROM analytics_events e LEFT JOIN properties p ON p.id = e.property_id
        WHERE ${FILTER} AND e.property_id IS NOT NULL ${scope}
        GROUP BY e.property_id, p.title, p.city ORDER BY views DESC LIMIT 15`,
    ),
    propertyIds
      ? Promise.resolve([] as { filter: string; uses: number }[])
      : run<{ filter: string; uses: number }>(
          `SELECT props->>'filter' AS filter, count(*)::int AS uses FROM analytics_events e
            WHERE ${FILTER} AND type = 'filter_change' AND props ? 'filter' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        ),
    propertyIds
      ? Promise.resolve([] as { band: string; searches: number }[])
      : run<{ band: string; searches: number }>(
          `SELECT coalesce(props->>'price_band', props->>'value') AS band, count(*)::int AS searches FROM analytics_events e
            WHERE ${FILTER} AND ((type = 'search_submit' AND props ? 'price_band') OR (type = 'filter_change' AND props->>'filter' = 'max_price'))
            GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
        ),
    // Property views followed by a contact action in the same session.
    run<{ property_id: string; title: string | null; sessions_viewed: number; sessions_contacted: number }>(
      `WITH v AS (
         SELECT e.session_id, e.property_id, min(e.occurred_at) AS first_view FROM analytics_events e
          WHERE ${FILTER} AND e.type = 'property_view' ${scope} GROUP BY 1, 2),
       c AS (
         SELECT session_id, min(occurred_at) AS first_contact FROM analytics_events e
          WHERE ${FILTER} AND type IN ('contact_submit', 'showing_request_submit', 'phone_click', 'email_click', 'form_start') GROUP BY 1)
       SELECT v.property_id, p.title, count(*)::int AS sessions_viewed,
              count(*) FILTER (WHERE c.first_contact > v.first_view)::int AS sessions_contacted
         FROM v LEFT JOIN c USING (session_id) LEFT JOIN properties p ON p.id = v.property_id
        GROUP BY v.property_id, p.title ORDER BY sessions_contacted DESC, sessions_viewed DESC LIMIT 10`,
    ),
    run<{ day: string; views: number }>(
      `SELECT to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS day, count(*)::int AS views FROM analytics_events e
        WHERE ${FILTER} AND type = 'property_view' ${scope} GROUP BY 1 ORDER BY 1`,
    ),
  ]);
  return { top, filters, priceBands, contacted, daily };
}

export async function conversionActivity(ctx: DbContext, r: Range) {
  return withDb(ctx, (db) =>
    db.query<{ type: string; count: number }>(
      `SELECT type, count(*)::int AS count FROM analytics_events e
        WHERE ${FILTER} AND category = 'conversion' GROUP BY type ORDER BY count DESC`,
      args(r),
    ),
  ).then((rows) => rows.map((x) => ({ ...x, label: EVENT_RULES[x.type]?.label ?? x.type })));
}

/**
 * Data-grounded recommendations. Each insight states its period and supporting numbers.
 * When the sample is too small, it says so instead of concluding anything.
 */
export async function insights(ctx: DbContext, r: Range) {
  const MIN_SESSIONS = 50;
  const span = r.to.getTime() - r.from.getTime();
  const previous: Range = { ...r, from: new Date(r.from.getTime() - span), to: r.from };
  const [now, before, f, pages] = await Promise.all([overview(ctx, r), overview(ctx, previous), funnel(ctx, r), overview(ctx, r).then((o) => o.pages)]);
  const period = `${r.from.toISOString().slice(0, 10)} to ${r.to.toISOString().slice(0, 10)}`;
  const out: { level: "info" | "opportunity" | "warning"; title: string; detail: string; metrics: Record<string, number | string> }[] = [];

  if (now.totals.sessions < MIN_SESSIONS) {
    out.push({
      level: "info",
      title: "Not enough data yet",
      detail: `Only ${now.totals.sessions} sessions were recorded for ${period}. Recommendations appear once at least ${MIN_SESSIONS} sessions are collected, so conclusions aren't drawn from noise.`,
      metrics: { sessions: now.totals.sessions, required: MIN_SESSIONS },
    });
    return { period, items: out };
  }

  const detail = f.find((s) => s.key === "detail")!;
  const conv = f.find((s) => s.key === "conversion")!;
  const contact = f.find((s) => s.key === "contact_action")!;
  if (detail.sessions >= 20 && contact.rate < 0.15) {
    out.push({
      level: "opportunity",
      title: "Property pages get views but few contact actions",
      detail: `${detail.sessions} sessions viewed a property but only ${contact.sessions} (${(contact.rate * 100).toFixed(1)}%) took a contact action during ${period}. Consider making "Request a showing" and the agent's phone more visible on listing pages. This is an observed pattern, not proof of cause.`,
      metrics: { detail_sessions: detail.sessions, contact_sessions: contact.sessions },
    });
  }
  if (contact.sessions >= 20 && conv.rate < 0.25) {
    out.push({
      level: "warning",
      title: "Contact actions often don't finish",
      detail: `${contact.sessions} sessions started a contact action, ${conv.sessions} completed a contact form or showing request (${(conv.rate * 100).toFixed(1)}%) during ${period}. Review form length and error messages.`,
      metrics: { started: contact.sessions, completed: conv.sessions },
    });
  }
  if (before.totals.sessions >= MIN_SESSIONS) {
    const growth = (now.totals.sessions - before.totals.sessions) / before.totals.sessions;
    const nowConv = now.daily.reduce((a, d) => a + d.conversions, 0);
    const beforeConv = before.daily.reduce((a, d) => a + d.conversions, 0);
    if (growth > 0.2 && nowConv <= beforeConv) {
      out.push({
        level: "opportunity",
        title: "Traffic grew but conversions didn't",
        detail: `Sessions rose ${(growth * 100).toFixed(0)}% versus the previous equal period (${before.totals.sessions} → ${now.totals.sessions}) while conversions went ${beforeConv} → ${nowConv}. Check whether new traffic sources match the homes you list.`,
        metrics: { sessions_before: before.totals.sessions, sessions_now: now.totals.sessions, conversions_before: beforeConv, conversions_now: nowConv },
      });
    }
  }
  const busiest = pages[0];
  const deep = now.scroll.find((s) => s.depth === 75);
  if (busiest && deep && now.totals.sessions && deep.sessions / now.totals.sessions < 0.3) {
    out.push({
      level: "info",
      title: "Most visitors don't reach the lower part of pages",
      detail: `Only ${deep.sessions} of ${now.totals.sessions} sessions scrolled to 75% of a page during ${period}. Put key actions (search, showing request) above the fold. The most-viewed page was ${busiest.path} (${busiest.views} views).`,
      metrics: { sessions_75pct: deep.sessions, sessions: now.totals.sessions },
    });
  }
  if (!out.length) {
    out.push({ level: "info", title: "No notable changes", detail: `Nothing crossed the alert thresholds for ${period}.`, metrics: { sessions: now.totals.sessions } });
  }
  return { period, items: out };
}

/** Agent view: engagement on the agent's own listings, plus their own leads. No browsing histories. */
export async function agentDashboard(agentId: string, teamId: string, r: Range) {
  const listings = await withSystemDb((db) =>
    db.query<{ id: string }>("SELECT id FROM properties WHERE team_id = $1 AND listing_agent_id = $2", [teamId, agentId]),
  );
  const ids = listings.map((l) => l.id);
  const engagement = ids.length ? await propertyEngagement("system", r, ids) : { top: [], filters: [], priceBands: [], contacted: [], daily: [] };
  const profileViews = await withSystemDb((db) =>
    db.one<{ views: number }>(
      `SELECT count(*)::int AS views FROM analytics_events e
        WHERE ${FILTER} AND type IN ('agent_profile_view', 'agent_profile_click') AND props->>'agent_id' = $4`,
      [...args(r), agentId],
    ),
  );
  return { listingCount: ids.length, engagement, agentProfileViews: profileViews?.views ?? 0 };
}

/** Delete events older than each project's retention period. Returns rows removed. */
export async function purgeExpired(): Promise<number> {
  const rows = await withSystemDb((db) =>
    db.query<{ n: number }>(
      `WITH d AS (
         DELETE FROM analytics_events e USING analytics_projects p
          WHERE p.key = e.project_key AND e.occurred_at < now() - make_interval(days => p.retention_days)
          RETURNING 1)
       SELECT count(*)::int AS n FROM d`,
    ),
  );
  return rows[0]?.n ?? 0;
}
