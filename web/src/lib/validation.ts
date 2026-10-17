import { z } from "zod";
import { DEAL_STAGES } from "./deal-rules";

/**
 * Input schemas shared by API routes and client forms. Money always arrives as
 * integer cents (`*Cents` fields); forms convert typed dollars with
 * dollarsToCents() before sending.
 */

const cents = (max = 100_000_000_000) =>
  z
    .number({ error: "Enter an amount." })
    .int("Amount must be whole cents.")
    .min(0, "Amount can't be negative.")
    .max(max, "Amount is too large.");

const trimmed = (min: number, max: number, label: string) =>
  z.string({ error: `${label} is required.` }).trim().min(min, `${label} is required.`).max(max, `${label} is too long.`);

export const e164 = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s().-]/g, ""))
  .transform((v) => (/^\d{10}$/.test(v) ? `+1${v}` : /^1\d{10}$/.test(v) ? `+${v}` : v))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, "Enter a valid phone number."));

/** Explicit consent to be contacted — required before a request reaches the team. */
export const consentToContact = z.literal(true, { error: "Please confirm we may contact you about this request." });

export const leadRequestSchema = z
  .object({
    contactName: z.string().trim().min(1, "Name is required.").max(120),
    contactEmail: z.email("Enter a valid email.").trim().toLowerCase().optional().nullable(),
    contactPhone: e164.optional().nullable(),
    message: z.string().trim().max(4000).optional().nullable(),
    propertyId: z.uuid().optional().nullable(),
    source: z.enum(["contact_form", "ai_assistant", "dual_move"]).default("contact_form"),
    preferences: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean(), z.array(z.string().max(60)).max(20)])).optional(),
    consentContact: consentToContact,
    website: z.string().max(0).optional(),
  })
  .refine((v) => v.contactEmail || v.contactPhone, { path: ["contactEmail"], message: "Add an email or a phone number so we can reach you." });

export const listingStatuses = ["draft", "active", "pending", "sold", "off_market"] as const;

/** Metadata for creating or updating a listing (the multipart `metadata` field, or JSON). */
export const listingInputSchema = z.object({
  title: trimmed(3, 140, "Title"),
  headline: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().max(20_000).default(""),
  addressLine: trimmed(3, 200, "Street address"),
  city: trimmed(2, 80, "City"),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Use the two-letter state code.")
    .default("ME"),
  postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Enter a 5-digit ZIP code."),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  status: z.enum(listingStatuses).default("draft"),
  listingType: z.enum(["sale", "rent"]).default("sale"),
  propertyType: z.enum(["single_family", "condo", "multi_family", "land", "commercial", "apartment"]).default("single_family"),
  garageSpaces: z.number().int().min(0).max(20).default(0),
  priceCents: cents(),
  hoaMonthlyCents: cents(10_000_000).default(0),
  taxAnnualCents: cents(100_000_000).default(0),
  bedrooms: z.number().int().min(0).max(50).default(0),
  fullBaths: z.number().int().min(0).max(50).default(0),
  halfBaths: z.number().int().min(0).max(50).default(0),
  livingAreaSqft: z.number().int().positive().max(1_000_000).nullable().optional(),
  lotSizeSqft: z.number().int().positive().max(1_000_000_000).nullable().optional(),
  yearBuilt: z.number().int().min(1600).max(2100).nullable().optional(),
  amenities: z.array(z.string().trim().min(1).max(60)).max(60).default([]),
  structuralFeatures: z.record(z.string().trim().min(1).max(60), z.string().trim().min(1).max(200)).default({}),
  schoolDistrict: z.string().trim().max(120).nullable().optional(),
  isFeatured: z.boolean().default(false),
  listingAgentId: z.uuid().nullable().optional(),
});
export type ListingInput = z.infer<typeof listingInputSchema>;

/**
 * Partial update: only the fields sent are changed. Defaults are stripped first — in zod v4
 * `.partial()` keeps them, so a patch without `status` would silently reset the listing to
 * "draft" (and amenities, garage etc. to their defaults).
 */
export const listingPatchSchema = z.object(
  Object.fromEntries(
    Object.entries(listingInputSchema.shape).map(([key, field]) => [key, (field instanceof z.ZodDefault ? field.unwrap() : field).optional()]),
  ) as unknown as { [K in keyof typeof listingInputSchema.shape]: z.ZodOptional<z.ZodType<z.infer<typeof listingInputSchema>[K]>> },
);

/** Password rule shared by sign-up and password reset. */
export const newPassword = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Include at least one letter and one number.");

export const signupSchema = z.object({
  fullName: trimmed(1, 120, "Name"),
  email: z.email("Enter a valid email.").trim().toLowerCase(),
  password: newPassword,
  phone: e164.optional(),
  acceptTerms: z.literal(true, { error: "Please accept the privacy notice to create an account." }),
});

export const loginSchema = z.object({
  email: z.email("Enter a valid email.").trim().toLowerCase(),
  password: z.string().min(1, "Enter your password."),
});

export const showingRequestSchema = z
  .object({
    propertyId: z.uuid(),
    contactName: trimmed(1, 120, "Name"),
    contactEmail: z.email("Enter a valid email.").trim().toLowerCase(),
    contactPhone: e164.optional().nullable(),
    startsAt: z.iso.datetime({ offset: true, error: "Pick a time." }),
    durationMinutes: z.number().int().min(15).max(180).default(45),
    notes: z.string().trim().max(1000).optional().nullable(),
    source: z.enum(["ai_assistant", "website", "mobile"]).default("website"),
    consentContact: consentToContact,
  })
  .refine((v) => new Date(v.startsAt).getTime() > Date.now() + 30 * 60_000, {
    path: ["startsAt"],
    message: "Pick a time at least 30 minutes from now.",
  });

export const showingUpdateSchema = z.object({
  status: z.enum(["requested", "confirmed", "completed", "cancelled"]),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const assistantRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(2000),
      }),
    )
    .min(1)
    .max(30)
    .refine((m) => m[m.length - 1]?.role === "user", "The last message must be from the user."),
  listingSlug: z.string().max(140).optional(),
});

export const collectionCreateSchema = z.object({ name: trimmed(1, 80, "Name") });

export const collectionItemSchema = z.object({
  propertyId: z.uuid(),
  reaction: z.enum(["love", "maybe", "pass"]).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

export const collectionCommentSchema = z.object({
  body: trimmed(1, 2000, "Comment"),
  propertyId: z.uuid().nullable().optional(),
});

export const utilityKinds = ["water", "electric", "gas", "sewer", "heating_oil", "internet"] as const;
export const usageUnits = ["gallons", "cubic_feet", "kwh", "therms", "none"] as const;
const isoDate = z.iso.date("Use YYYY-MM-DD.");

export const utilityBillSchema = z
  .object({
    propertyId: z.uuid(),
    utility: z.enum(utilityKinds),
    provider: trimmed(1, 120, "Provider"),
    accountLast4: z
      .string()
      .regex(/^\d{4}$/, "Last four digits only.")
      .nullable()
      .optional(),
    periodStart: isoDate,
    periodEnd: isoDate,
    usageQuantity: z.number().int().min(0).nullable().optional(),
    usageUnit: z.enum(usageUnits).nullable().optional(),
    amountCents: cents(1_000_000_000).refine((v) => v > 0, "Amount must be greater than zero."),
    dueOn: isoDate.nullable().optional(),
    paidOn: isoDate.nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => v.periodEnd >= v.periodStart, { path: ["periodEnd"], message: "End must be on or after the start." });

export const teamMemberSchema = z.object({
  fullName: trimmed(1, 120, "Name"),
  email: z.email("Enter a valid email.").trim().toLowerCase(),
  title: trimmed(1, 120, "Title"),
  bio: z.string().trim().max(4000).nullable().optional(),
  phone: e164.nullable().optional(),
  photoUrl: z.string().trim().max(500).nullable().optional(),
  specialties: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
  role: z.enum(["admin", "agent"]).default("agent"),
  isPublic: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
});

export const webhookSchema = z.object({
  url: z.url("Enter a valid URL.").refine((u) => /^https?:\/\//.test(u), "Use an http(s) URL."),
  events: z
    .array(z.enum(["listing.published", "listing.updated", "media.uploaded", "showing.requested", "showing.updated", "collection.activity", "lead.created", "deal.stage_changed"]))
    .default([]),
});

/** New deal (transaction). Money in integer cents, commission in basis points. */
export const dealCreateSchema = z.object({
  title: z.string().trim().min(2, "Give the deal a name.").max(140),
  side: z.enum(["buyer", "seller", "dual", "lease"]),
  stage: z.enum(DEAL_STAGES).default("prospect"),
  propertyId: z.uuid().nullable().optional(),
  clientName: z.string().trim().min(1, "Client name is required.").max(120),
  clientEmail: z.email("Enter a valid email.").trim().toLowerCase().nullable().optional(),
  agentId: z.uuid().nullable().optional(),
  priceCents: z.number().int("Whole cents only.").min(0).max(100_000_000_000).nullable().optional(),
  commissionBps: z.number().int().min(0).max(1500).nullable().optional(),
  contractDate: z.iso.date().nullable().optional(),
  closingDate: z.iso.date().nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

export const forgotPasswordSchema = z.object({ email: z.email("Enter a valid email.").trim().toLowerCase() });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(100), password: newPassword });
export const verifyEmailSchema = z.object({ token: z.string().min(20).max(100) });
