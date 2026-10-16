import "server-only";
import type { AgentCard, ListingCard, ListingDetail, MediaImage, Team } from "@/lib/types";

/** Database rows (snake_case) → API JSON (camelCase). One place, so web and mobile get identical shapes. */

type Renditions = MediaImage["variants"];

export interface ListingRow {
  id: string;
  slug: string;
  status: ListingCard["status"];
  listing_type: ListingCard["listingType"];
  title: string;
  headline: string | null;
  address_line: string;
  city: string;
  state: string;
  postal_code: string;
  latitude: number | null;
  longitude: number | null;
  price_cents: number;
  bedrooms: number;
  full_baths: number;
  half_baths: number;
  living_area_sqft: number | null;
  lot_size_sqft: number | null;
  year_built: number | null;
  school_district: string | null;
  walk_score: number | null;
  is_featured: boolean;
  published_at: Date | null;
  updated_at: Date;
  cover_url: string | null;
  cover_variants: Renditions | null;
  cover_blur: string | null;
  cover_width: number | null;
  cover_height: number | null;
  media_count: number;
  property_type: ListingCard["propertyType"];
  garage_spaces: number;
  source: ListingCard["source"];
  status_verified_at: Date;
}

/** Columns for ListingRow when selecting from `properties p` (cover via lateral join `cover`). */
export const LISTING_COLUMNS = `
  p.id, p.slug, p.status, p.listing_type, p.title, p.headline, p.address_line, p.city, p.state, p.postal_code,
  p.latitude, p.longitude, p.price_cents, p.bedrooms, p.full_baths, p.half_baths, p.living_area_sqft,
  p.lot_size_sqft, p.year_built, p.school_district, p.walk_score, p.is_featured, p.published_at, p.updated_at,
  p.property_type, p.garage_spaces, p.source, p.status_verified_at,
  cover.url AS cover_url, cover.variants AS cover_variants, cover.blur_data_url AS cover_blur,
  cover.width AS cover_width, cover.height AS cover_height,
  (SELECT count(*) FROM media_assets m WHERE m.property_id = p.id)::int AS media_count`;

export const COVER_JOIN = `
  LEFT JOIN LATERAL (
    SELECT m.url, m.variants, m.blur_data_url, m.width, m.height
      FROM media_assets m
     WHERE m.property_id = p.id AND m.kind = 'image'
     ORDER BY m.is_cover DESC, m.sort_order, m.created_at
     LIMIT 1
  ) cover ON true`;

export function toListingCard(row: ListingRow): ListingCard {
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    listingType: row.listing_type,
    title: row.title,
    headline: row.headline,
    addressLine: row.address_line,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    latitude: row.latitude,
    longitude: row.longitude,
    priceCents: row.price_cents,
    bedrooms: row.bedrooms,
    fullBaths: row.full_baths,
    halfBaths: row.half_baths,
    livingAreaSqft: row.living_area_sqft,
    lotSizeSqft: row.lot_size_sqft,
    yearBuilt: row.year_built,
    schoolDistrict: row.school_district,
    walkScore: row.walk_score,
    isFeatured: row.is_featured,
    publishedAt: row.published_at?.toISOString() ?? null,
    updatedAt: row.updated_at.toISOString(),
    cover:
      row.cover_url && row.cover_width && row.cover_height
        ? {
            url: row.cover_url,
            width: row.cover_width,
            height: row.cover_height,
            blurDataUrl: row.cover_blur,
            variants: row.cover_variants ?? {},
          }
        : null,
    mediaCount: row.media_count,
    propertyType: row.property_type,
    garageSpaces: row.garage_spaces,
    source: row.source,
    statusVerifiedAt: row.status_verified_at.toISOString(),
  };
}

export interface MediaRow {
  id: string;
  url: string;
  width: number;
  height: number;
  blur_data_url: string | null;
  alt_text: string;
  is_cover: boolean;
  variants: Renditions;
}

export function toMediaImage(row: MediaRow): MediaImage {
  return {
    id: row.id,
    url: row.url,
    width: row.width,
    height: row.height,
    blurDataUrl: row.blur_data_url,
    alt: row.alt_text,
    isCover: row.is_cover,
    variants: row.variants ?? {},
  };
}

export interface AgentRow {
  id: string;
  full_name: string;
  title: string | null;
  bio: string | null;
  photo_url: string | null;
  phone: string | null;
  email: string;
  specialties: string[];
  is_leader: boolean;
}

export const AGENT_COLUMNS = "u.id, u.full_name, u.title, u.bio, u.photo_url, u.phone, u.email, u.specialties, u.is_leader";

export function toAgentCard(row: AgentRow): AgentCard {
  return {
    id: row.id,
    fullName: row.full_name,
    title: row.title,
    bio: row.bio,
    photoUrl: row.photo_url,
    phone: row.phone,
    email: row.email,
    specialties: row.specialties ?? [],
    isLeader: row.is_leader,
  };
}

export function toListingDetail(
  row: ListingRow & {
    description: string;
    hoa_monthly_cents: number;
    tax_annual_cents: number;
    amenities: string[];
    structural_features: Record<string, string>;
  },
  media: MediaRow[],
  agent: AgentRow | null,
): ListingDetail {
  return {
    ...toListingCard(row),
    description: row.description,
    hoaMonthlyCents: row.hoa_monthly_cents,
    taxAnnualCents: row.tax_annual_cents,
    amenities: row.amenities ?? [],
    structuralFeatures: row.structural_features ?? {},
    media: media.map(toMediaImage),
    agent: agent ? toAgentCard(agent) : null,
  };
}

export interface TeamRow {
  id: string;
  slug: string;
  name: string;
  market: string;
  office_phone: string | null;
  office_email: string | null;
  office_address: string | null;
  founded_year: number | null;
}

export function toTeam(row: TeamRow): Team {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    market: row.market,
    officePhone: row.office_phone,
    officeEmail: row.office_email,
    officeAddress: row.office_address,
    foundedYear: row.founded_year,
  };
}
