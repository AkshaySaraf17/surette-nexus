/**
 * JSON shapes returned by the API. The mobile app mirrors these in
 * mobile/src/api.ts — keep the two in sync. All money fields are integer cents.
 */

export type ListingStatus = "draft" | "active" | "pending" | "sold" | "off_market";
export type ListingType = "sale" | "rent";
export type UserRole = "admin" | "agent" | "client";
export type ShowingStatus = "requested" | "confirmed" | "completed" | "cancelled";
export type Reaction = "love" | "maybe" | "pass";
export type UtilityKind = "water" | "electric" | "gas" | "sewer" | "heating_oil" | "internet";

export interface ImageRendition {
  url: string;
  width: number;
  height: number;
}

export interface MediaImage {
  id: string;
  url: string;
  width: number;
  height: number;
  blurDataUrl: string | null;
  alt: string;
  isCover: boolean;
  variants: Partial<Record<"sm" | "md" | "xl", ImageRendition>>;
}

export interface ListingCard {
  id: string;
  slug: string;
  status: ListingStatus;
  listingType: ListingType;
  title: string;
  headline: string | null;
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  priceCents: number;
  bedrooms: number;
  fullBaths: number;
  halfBaths: number;
  livingAreaSqft: number | null;
  lotSizeSqft: number | null;
  yearBuilt: number | null;
  schoolDistrict: string | null;
  walkScore: number | null;
  isFeatured: boolean;
  publishedAt: string | null;
  updatedAt: string;
  cover: Omit<MediaImage, "id" | "isCover" | "alt"> | null;
  mediaCount: number;
  propertyType: "single_family" | "condo" | "multi_family" | "land" | "commercial" | "apartment";
  garageSpaces: number;
  /** Where the record came from: entered by the team, CSV import, MLS feed, or synthetic demo data. */
  source: "portal" | "csv_import" | "mls_feed" | "demo";
  /** When an agent last set or confirmed the listing status. */
  statusVerifiedAt: string;
}

export interface AgentCard {
  id: string;
  fullName: string;
  title: string | null;
  bio: string | null;
  photoUrl: string | null;
  phone: string | null;
  email: string;
  specialties: string[];
  isLeader: boolean;
}

export interface ListingDetail extends ListingCard {
  description: string;
  hoaMonthlyCents: number;
  taxAnnualCents: number;
  amenities: string[];
  structuralFeatures: Record<string, string>;
  media: MediaImage[];
  agent: AgentCard | null;
}

export interface Team {
  id: string;
  slug: string;
  name: string;
  market: string;
  officePhone: string | null;
  officeEmail: string | null;
  officeAddress: string | null;
  foundedYear: number | null;
}

export interface Viewer {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  teamId: string | null;
  assignedAgentId: string | null;
  /** Customers must confirm their email before saving homes, searches and plans. */
  emailVerified: boolean;
}

export interface Showing {
  id: string;
  propertyId: string;
  propertyTitle: string;
  propertySlug: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  startsAt: string;
  endsAt: string;
  status: ShowingStatus;
  source: "ai_assistant" | "website" | "agent" | "mobile";
  notes: string | null;
  agentName: string | null;
  createdAt: string;
}

export interface CollectionItem {
  listing: ListingCard;
  reaction: Reaction | null;
  note: string | null;
  addedAt: string;
}

export interface CollectionComment {
  id: string;
  propertyId: string | null;
  authorId: string;
  authorName: string;
  authorRole: UserRole;
  body: string;
  createdAt: string;
}

export interface Collection {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  agent: { id: string; fullName: string; photoUrl: string | null } | null;
  items: CollectionItem[];
  comments: CollectionComment[];
  updatedAt: string;
}

export interface UtilityBill {
  id: string;
  propertyId: string;
  propertyTitle: string;
  utility: UtilityKind;
  provider: string;
  accountLast4: string | null;
  periodStart: string;
  periodEnd: string;
  usageQuantity: number | null;
  usageUnit: "gallons" | "cubic_feet" | "kwh" | "therms" | "none" | null;
  amountCents: number;
  dueOn: string | null;
  paidOn: string | null;
  notes: string | null;
  createdAt: string;
}

/** Messages streamed by POST /api/agent/assistant (newline-delimited JSON). */
export type AssistantEvent =
  | { type: "text"; delta: string }
  | { type: "listings"; listings: ListingCard[]; matches: Record<string, { met: string[]; unmet: string[] }>; relaxed: string | null; criteria: string[] }
  | { type: "market"; facts: { label: string; value: string; source: string; period: string; retrievedAt: string }[] }
  | { type: "links"; links: { label: string; href: string }[] }
  | { type: "followup"; questions: string[] }
  | { type: "save_search"; criteria: Record<string, unknown>; signedIn: boolean }
  | { type: "handoff"; preferences: string[]; propertyId: string | null }
  | { type: "showing_proposal"; listing: ListingCard; slots: { startsAt: string; endsAt: string }[] }
  | { type: "error"; message: string }
  | { type: "done"; engine: "ollama" | "rules" };

/** Server-Sent Event payload relayed from Postgres NOTIFY. */
export interface LiveEvent {
  table: "properties" | "media_assets" | "showings" | "collections" | "collection_items" | "collection_comments" | "leads" | "transactions" | "transaction_milestones" | "transaction_tasks" | "transaction_documents";
  op: "insert" | "update" | "delete";
  propertyId: string | null;
  collectionId: string | null;
  transactionId?: string | null;
  at: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}
