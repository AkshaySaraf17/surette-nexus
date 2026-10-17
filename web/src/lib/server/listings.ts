import "server-only";
import type { AgentCard, ListingCard, ListingDetail, Team } from "@/lib/types";
import { cached } from "./cache";
import { withDb, ANONYMOUS, type DbContext } from "./db";
import { ensureLiveInvalidation } from "./live-cache";
import { ApiError } from "./errors";
import {
  AGENT_COLUMNS,
  COVER_JOIN,
  LISTING_COLUMNS,
  toAgentCard,
  toListingCard,
  toListingDetail,
  toTeam,
  type AgentRow,
  type ListingRow,
  type MediaRow,
  type TeamRow,
} from "./serializers";

/** The agent_teams row this deployment represents (SITE_TEAM_SLUG, default "surette"). */
export async function getSiteTeam(): Promise<Team> {
  const slug = process.env.SITE_TEAM_SLUG?.trim() || "surette";
  return cached(`team:${slug}`, { ttlMs: 5 * 60_000, tags: ["team"] }, () => loadSiteTeam(slug));
}

async function loadSiteTeam(slug: string): Promise<Team> {
  const row = await withDb(ANONYMOUS, (db) => db.one<TeamRow>("SELECT * FROM agent_teams WHERE slug = $1", [slug]));
  if (!row) throw new ApiError(503, "SITE_NOT_CONFIGURED", `No team with slug "${slug}". Run npm run db:seed.`);
  return toTeam(row);
}

export interface ListingFilters {
  q?: string;
  city?: string;
  type?: "sale" | "rent";
  minPriceCents?: number;
  maxPriceCents?: number;
  minBeds?: number;
  minBaths?: number;
  minGarage?: number;
  minSqft?: number;
  minLotSqft?: number;
  propertyType?: string;
  ids?: string[];
  includeSold?: boolean;
  featuredOnly?: boolean;
  sort?: "featured" | "newest" | "price_asc" | "price_desc";
  limit?: number;
}

/**
 * Published listings for the site's team. Staff contexts may also pass includeDrafts.
 * Anonymous (public) results are cached for 60 s and dropped instantly when any listing
 * or photo changes; signed-in views always read through RLS.
 */
export async function listListings(
  context: DbContext,
  filters: ListingFilters = {},
  options: { includeDrafts?: boolean } = {},
): Promise<ListingCard[]> {
  if (context.role === "anonymous" && !options.includeDrafts) {
    ensureLiveInvalidation();
    return cached(`listings:${JSON.stringify(filters)}`, { ttlMs: 60_000, tags: ["listings"] }, () => queryListings(context, filters, options));
  }
  return queryListings(context, filters, options);
}

async function queryListings(context: DbContext, filters: ListingFilters, options: { includeDrafts?: boolean }): Promise<ListingCard[]> {
  const team = await getSiteTeam();
  const where: string[] = ["p.team_id = $1"];
  const values: unknown[] = [team.id];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    where.push(sql.replace("?", `$${values.length}`));
  };

  if (options.includeDrafts) {
    // RLS still limits drafts to staff of the team.
  } else if (filters.includeSold) {
    where.push("p.status IN ('active', 'pending', 'sold')");
  } else {
    where.push("p.status IN ('active', 'pending')");
  }
  if (filters.q?.trim()) add("p.search_vector @@ websearch_to_tsquery('english', ?)", filters.q.trim());
  if (filters.city?.trim()) add("lower(p.city) = lower(?)", filters.city.trim());
  if (filters.type) add("p.listing_type = ?::listing_type", filters.type);
  if (filters.minPriceCents !== undefined) add("p.price_cents >= ?", filters.minPriceCents);
  if (filters.maxPriceCents !== undefined) add("p.price_cents <= ?", filters.maxPriceCents);
  if (filters.minBeds !== undefined) add("p.bedrooms >= ?", filters.minBeds);
  if (filters.minBaths !== undefined) add("(p.full_baths + p.half_baths * 0.5) >= ?", filters.minBaths);
  if (filters.minGarage !== undefined) add("p.garage_spaces >= ?", filters.minGarage);
  if (filters.minSqft !== undefined) add("p.living_area_sqft >= ?", filters.minSqft);
  if (filters.minLotSqft !== undefined) add("p.lot_size_sqft >= ?", filters.minLotSqft);
  if (filters.propertyType) add("p.property_type = ?::property_type", filters.propertyType);
  if (filters.ids?.length) add("p.id = ANY(?::uuid[])", filters.ids);
  if (filters.featuredOnly) where.push("p.is_featured");

  const order = {
    featured: "p.is_featured DESC, (p.status = 'active') DESC, p.published_at DESC NULLS LAST",
    newest: "p.published_at DESC NULLS LAST, p.created_at DESC",
    price_asc: "p.price_cents ASC",
    price_desc: "p.price_cents DESC",
  }[filters.sort ?? "featured"];
  const limit = Math.min(Math.max(filters.limit ?? 60, 1), 200);

  const rows = await withDb(context, (db) =>
    db.query<ListingRow>(
      `SELECT ${LISTING_COLUMNS} FROM properties p ${COVER_JOIN}
        WHERE ${where.join(" AND ")}
        ORDER BY ${order}
        LIMIT ${limit}`,
      values,
    ),
  );
  return rows.map(toListingCard);
}

type DetailRow = ListingRow & {
  description: string;
  hoa_monthly_cents: number;
  tax_annual_cents: number;
  amenities: string[];
  structural_features: Record<string, string>;
  listing_agent_id: string | null;
  team_id: string;
};

async function loadDetail(context: DbContext, where: string, value: string): Promise<ListingDetail | null> {
  return withDb(context, async (db) => {
    const row = await db.one<DetailRow>(
      `SELECT ${LISTING_COLUMNS}, p.description, p.hoa_monthly_cents, p.tax_annual_cents, p.amenities,
              p.structural_features, p.listing_agent_id, p.team_id
         FROM properties p ${COVER_JOIN}
        WHERE ${where}`,
      [value],
    );
    if (!row) return null;
    const media = await db.query<MediaRow>(
      `SELECT id, url, width, height, blur_data_url, alt_text, is_cover, variants
         FROM media_assets WHERE property_id = $1 AND kind = 'image'
        ORDER BY is_cover DESC, sort_order, created_at`,
      [row.id],
    );
    const agent = row.listing_agent_id
      ? await db.one<AgentRow>(`SELECT ${AGENT_COLUMNS} FROM users u WHERE u.id = $1`, [row.listing_agent_id])
      : await db.one<AgentRow>(
          `SELECT ${AGENT_COLUMNS} FROM users u WHERE u.team_id = $1 AND u.is_leader AND u.is_public LIMIT 1`,
          [row.team_id],
        );
    return toListingDetail(row, media, agent);
  });
}

export function getListingBySlug(context: DbContext, slug: string): Promise<ListingDetail | null> {
  return loadDetail(context, "p.slug = $1", slug);
}

export function getListingById(context: DbContext, id: string): Promise<ListingDetail | null> {
  return loadDetail(context, "p.id = $1", id);
}

/** The public team directory: leader first, then sort order. */
export async function listTeamMembers(context: DbContext = ANONYMOUS): Promise<AgentCard[]> {
  if (context.role === "anonymous") return cached("team-members", { ttlMs: 5 * 60_000, tags: ["team"] }, () => queryTeamMembers(context));
  return queryTeamMembers(context);
}

async function queryTeamMembers(context: DbContext): Promise<AgentCard[]> {
  const team = await getSiteTeam();
  const rows = await withDb(context, (db) =>
    db.query<AgentRow>(
      `SELECT ${AGENT_COLUMNS} FROM users u
        WHERE u.team_id = $1 AND u.is_public AND u.role IN ('admin', 'agent')
        ORDER BY u.is_leader DESC, u.sort_order, u.full_name`,
      [team.id],
    ),
  );
  return rows.map(toAgentCard);
}

/** Distinct towns with published listings, for filters and the AI assistant. */
export async function listCities(): Promise<string[]> {
  ensureLiveInvalidation();
  return cached("cities", { ttlMs: 60_000, tags: ["listings"] }, queryCities);
}

async function queryCities(): Promise<string[]> {
  const team = await getSiteTeam();
  const rows = await withDb(ANONYMOUS, (db) =>
    db.query<{ city: string }>(
      "SELECT DISTINCT city FROM properties WHERE team_id = $1 AND status IN ('active', 'pending') ORDER BY city",
      [team.id],
    ),
  );
  return rows.map((r) => r.city);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}
