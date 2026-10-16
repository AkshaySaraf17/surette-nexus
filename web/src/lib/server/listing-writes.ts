import "server-only";
import type { Viewer } from "@/lib/types";
import { walkIndex, districtFor } from "@/lib/geo";
import type { ListingInput } from "@/lib/validation";
import type { Db } from "./db";
import { ApiError, notFound } from "./errors";
import { slugify } from "./listings";

/**
 * Insert or update a listing inside an existing RLS transaction. Derives the
 * Walk Index and (if not given) the school district from the coordinates, and
 * gives new listings a unique, readable slug. Returns the property id and
 * whether this write published it (draft → public) for webhooks.
 */

const COLUMN_MAP: Record<keyof ListingInput, string> = {
  title: "title",
  headline: "headline",
  description: "description",
  addressLine: "address_line",
  city: "city",
  state: "state",
  postalCode: "postal_code",
  latitude: "latitude",
  longitude: "longitude",
  status: "status",
  listingType: "listing_type",
  propertyType: "property_type",
  garageSpaces: "garage_spaces",
  priceCents: "price_cents",
  hoaMonthlyCents: "hoa_monthly_cents",
  taxAnnualCents: "tax_annual_cents",
  bedrooms: "bedrooms",
  fullBaths: "full_baths",
  halfBaths: "half_baths",
  livingAreaSqft: "living_area_sqft",
  lotSizeSqft: "lot_size_sqft",
  yearBuilt: "year_built",
  amenities: "amenities",
  structuralFeatures: "structural_features",
  schoolDistrict: "school_district",
  isFeatured: "is_featured",
  listingAgentId: "listing_agent_id",
};

const CASTS: Partial<Record<string, string>> = {
  status: "::listing_status",
  listing_type: "::listing_type",
  property_type: "::property_type",
  structural_features: "::jsonb",
};

function derived(input: Partial<ListingInput>): Partial<Record<string, unknown>> {
  if (input.latitude == null || input.longitude == null) return {};
  const position: [number, number] = [input.longitude, input.latitude];
  const out: Record<string, unknown> = { walk_score: walkIndex(position) };
  if (input.schoolDistrict === undefined || input.schoolDistrict === null) {
    const district = districtFor(position);
    if (district) out.school_district = district.name;
  }
  return out;
}

async function uniqueSlug(db: Db, base: string): Promise<string> {
  const root = slugify(base) || "listing";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const taken = await db.one("SELECT 1 FROM properties WHERE slug = $1", [candidate]);
    if (!taken) return candidate;
  }
  return `${root}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function createListing(db: Db, viewer: Viewer & { teamId: string }, input: ListingInput, id: string = crypto.randomUUID()) {
  const slug = await uniqueSlug(db, `${input.title} ${input.city}`);
  const values: Record<string, unknown> = {
    id,
    team_id: viewer.teamId,
    slug,
    created_by: viewer.id,
    listing_agent_id: input.listingAgentId ?? viewer.id,
    ...derived(input),
  };
  for (const [key, column] of Object.entries(COLUMN_MAP) as [keyof ListingInput, string][]) {
    if (key === "listingAgentId") continue;
    const value = input[key];
    if (value !== undefined && !(column in values)) values[column] = key === "structuralFeatures" ? JSON.stringify(value) : value;
  }
  const columns = Object.keys(values);
  const placeholders = columns.map((c, i) => `$${i + 1}${CASTS[c] ?? ""}`);
  await db.query(`INSERT INTO properties (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`, Object.values(values));
  return { id, slug, published: input.status !== "draft" };
}

export async function updateListing(db: Db, id: string, patch: Partial<ListingInput>) {
  const before = await db.one<{ status: string; latitude: number | null; longitude: number | null; slug: string; team_id: string }>(
    "SELECT status, latitude, longitude, slug, team_id FROM properties WHERE id = $1",
    [id],
  );
  if (!before) throw notFound("Listing");
  const merged = { latitude: before.latitude, longitude: before.longitude, ...patch };
  const values: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(COLUMN_MAP) as [keyof ListingInput, string][]) {
    const value = patch[key];
    if (value !== undefined) values[column] = key === "structuralFeatures" ? JSON.stringify(value) : value;
  }
  if (patch.latitude !== undefined || patch.longitude !== undefined) {
    if ((merged.latitude == null) !== (merged.longitude == null)) {
      throw new ApiError(400, "VALIDATION_ERROR", "Provide both latitude and longitude.", { latitude: "Provide both coordinates." });
    }
    Object.assign(values, derived({ latitude: merged.latitude, longitude: merged.longitude, schoolDistrict: patch.schoolDistrict }));
  }
  const columns = Object.keys(values);
  if (columns.length) {
    const sets = columns.map((c, i) => `${c} = $${i + 2}${CASTS[c] ?? ""}`);
    const updated = await db.query(`UPDATE properties SET ${sets.join(", ")} WHERE id = $1 RETURNING id`, [id, ...Object.values(values)]);
    if (updated.length === 0) throw new ApiError(403, "FORBIDDEN", "You can't edit this listing.");
  }
  const published = before.status === "draft" && patch.status !== undefined && patch.status !== "draft";
  return { id, slug: before.slug, teamId: before.team_id, published };
}
