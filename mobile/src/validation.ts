import type { ListingMetadata, ListingStatus } from "./api";

/**
 * Field validation for the listing form, mirroring the server's zod schema so
 * errors show instantly (the server validates again). Dollars are parsed as
 * strings straight into integer cents — never through a float.
 */

/** "1,250,000" / "$410.67" → 125000000 / 41067; null when invalid. */
export function dollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function centsToDollars(cents: number): string {
  if (!cents) return "";
  return `${Math.floor(cents / 100)}${cents % 100 ? `.${String(cents % 100).padStart(2, "0")}` : ""}`;
}

export interface ListingFormValues {
  title: string;
  headline: string;
  description: string;
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  latitude: string;
  longitude: string;
  status: ListingStatus;
  listingType: "sale" | "rent";
  price: string;
  tax: string;
  hoa: string;
  bedrooms: string;
  fullBaths: string;
  halfBaths: string;
  livingAreaSqft: string;
  lotSizeSqft: string;
  yearBuilt: string;
  isFeatured: boolean;
  amenities: string[];
  features: { key: string; value: string }[];
}

export const emptyListing: ListingFormValues = {
  title: "",
  headline: "",
  description: "",
  addressLine: "",
  city: "Waterville",
  state: "ME",
  postalCode: "",
  latitude: "",
  longitude: "",
  status: "draft",
  listingType: "sale",
  price: "",
  tax: "",
  hoa: "",
  bedrooms: "",
  fullBaths: "",
  halfBaths: "0",
  livingAreaSqft: "",
  lotSizeSqft: "",
  yearBuilt: "",
  isFeatured: false,
  amenities: [],
  features: [
    { key: "Foundation", value: "" },
    { key: "Roof", value: "" },
    { key: "Heating", value: "" },
  ],
};

const wholeNumber = (v: string): number | null | "invalid" => {
  const t = v.trim();
  if (!t) return null;
  return /^\d+$/.test(t) ? Number(t) : "invalid";
};

/** Returns either the API metadata or a map of field → message. */
export function validateListing(v: ListingFormValues): { metadata: ListingMetadata; errors: null } | { metadata: null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (v.title.trim().length < 3) errors.title = "Give the listing a title (3+ characters).";
  if (v.addressLine.trim().length < 3) errors.addressLine = "Enter the street address.";
  if (v.city.trim().length < 2) errors.city = "Enter the town.";
  if (!/^[A-Za-z]{2}$/.test(v.state.trim())) errors.state = "Two letters, e.g. ME.";
  if (!/^\d{5}(-\d{4})?$/.test(v.postalCode.trim())) errors.postalCode = "5-digit ZIP.";
  const priceCents = dollarsToCents(v.price);
  if (!priceCents) errors.price = "Enter the price, e.g. 1,250,000.";
  const taxAnnualCents = v.tax.trim() ? dollarsToCents(v.tax) : 0;
  if (taxAnnualCents === null) errors.tax = "Dollar amount only.";
  const hoaMonthlyCents = v.hoa.trim() ? dollarsToCents(v.hoa) : 0;
  if (hoaMonthlyCents === null) errors.hoa = "Dollar amount only.";

  const counts = {
    bedrooms: wholeNumber(v.bedrooms),
    fullBaths: wholeNumber(v.fullBaths),
    halfBaths: wholeNumber(v.halfBaths),
    livingAreaSqft: wholeNumber(v.livingAreaSqft),
    lotSizeSqft: wholeNumber(v.lotSizeSqft),
    yearBuilt: wholeNumber(v.yearBuilt),
  };
  for (const [k, n] of Object.entries(counts)) if (n === "invalid") errors[k] = "Whole number.";
  if (typeof counts.yearBuilt === "number" && (counts.yearBuilt < 1600 || counts.yearBuilt > 2100)) errors.yearBuilt = "1600–2100.";

  const lat = v.latitude.trim() ? Number(v.latitude) : null;
  const lng = v.longitude.trim() ? Number(v.longitude) : null;
  if ((lat === null) !== (lng === null)) errors.latitude = "Enter both coordinates, or neither.";
  if (lat !== null && (Number.isNaN(lat) || lat < -90 || lat > 90)) errors.latitude = "Latitude must be −90 to 90.";
  if (lng !== null && (Number.isNaN(lng) || lng < -180 || lng > 180)) errors.longitude = "Longitude must be −180 to 180.";

  if (Object.keys(errors).length) return { metadata: null, errors };
  const n = (x: number | null | "invalid") => (typeof x === "number" ? x : null);
  return {
    errors: null,
    metadata: {
      title: v.title.trim(),
      headline: v.headline.trim() || null,
      description: v.description.trim(),
      addressLine: v.addressLine.trim(),
      city: v.city.trim(),
      state: v.state.trim().toUpperCase(),
      postalCode: v.postalCode.trim(),
      latitude: lat,
      longitude: lng,
      status: v.status,
      listingType: v.listingType,
      priceCents: priceCents!,
      taxAnnualCents: taxAnnualCents!,
      hoaMonthlyCents: hoaMonthlyCents!,
      bedrooms: n(counts.bedrooms) ?? 0,
      fullBaths: n(counts.fullBaths) ?? 0,
      halfBaths: n(counts.halfBaths) ?? 0,
      livingAreaSqft: n(counts.livingAreaSqft),
      lotSizeSqft: n(counts.lotSizeSqft),
      yearBuilt: n(counts.yearBuilt),
      isFeatured: v.isFeatured,
      amenities: v.amenities,
      structuralFeatures: Object.fromEntries(v.features.filter((f) => f.key.trim() && f.value.trim()).map((f) => [f.key.trim(), f.value.trim()])),
    },
  };
}
