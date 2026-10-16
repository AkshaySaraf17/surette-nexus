"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, ApiClientError } from "@/lib/client-api";
import { dollarsToCents } from "@/lib/money";
import type { ListingDetail } from "@/lib/types";
import { PhotoUploader, UploadProgress, uploadListing, type PendingPhoto } from "./photo-uploader";

/**
 * Property initialization / edit form: title, address, description, amenities,
 * structural features, pricing and photos. Dollar inputs are converted to integer
 * cents with dollarsToCents (string parsing, never floats) before sending.
 * Validation runs here for instant feedback and again on the server (zod + SQL CHECKs).
 */

interface FormState {
  title: string;
  headline: string;
  description: string;
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  latitude: string;
  longitude: string;
  status: "draft" | "active" | "pending" | "sold" | "off_market";
  listingType: "sale" | "rent";
  price: string;
  hoa: string;
  tax: string;
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

const centsToDollars = (c: number) => (c ? `${Math.floor(c / 100)}${c % 100 ? `.${String(c % 100).padStart(2, "0")}` : ""}` : "");

function fromListing(l?: ListingDetail): FormState {
  return {
    title: l?.title ?? "",
    headline: l?.headline ?? "",
    description: l?.description ?? "",
    addressLine: l?.addressLine ?? "",
    city: l?.city ?? "Waterville",
    state: l?.state ?? "ME",
    postalCode: l?.postalCode ?? "",
    latitude: l?.latitude?.toString() ?? "",
    longitude: l?.longitude?.toString() ?? "",
    status: l?.status ?? "draft",
    listingType: l?.listingType ?? "sale",
    price: l ? centsToDollars(l.priceCents) : "",
    hoa: l ? centsToDollars(l.hoaMonthlyCents) : "",
    tax: l ? centsToDollars(l.taxAnnualCents) : "",
    bedrooms: l?.bedrooms.toString() ?? "",
    fullBaths: l?.fullBaths.toString() ?? "",
    halfBaths: l?.halfBaths.toString() ?? "0",
    livingAreaSqft: l?.livingAreaSqft?.toString() ?? "",
    lotSizeSqft: l?.lotSizeSqft?.toString() ?? "",
    yearBuilt: l?.yearBuilt?.toString() ?? "",
    isFeatured: l?.isFeatured ?? false,
    amenities: l?.amenities ?? [],
    features: l ? Object.entries(l.structuralFeatures).map(([key, value]) => ({ key, value })) : [{ key: "Foundation", value: "" }, { key: "Roof", value: "" }, { key: "Heating", value: "" }],
  };
}

const int = (v: string) => (v.trim() === "" ? null : /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);
const num = (v: string) => (v.trim() === "" ? null : Number(v));

/** Client-side validation + conversion to the API's metadata shape. */
function toMetadata(s: FormState): { metadata?: Record<string, unknown>; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (s.title.trim().length < 3) errors.title = "Give the listing a title.";
  if (s.addressLine.trim().length < 3) errors.addressLine = "Enter the street address.";
  if (s.city.trim().length < 2) errors.city = "Enter the town.";
  if (!/^\d{5}(-\d{4})?$/.test(s.postalCode.trim())) errors.postalCode = "Enter a 5-digit ZIP code.";
  const priceCents = dollarsToCents(s.price);
  if (priceCents === null || priceCents === 0) errors.priceCents = "Enter the price, e.g. 1,250,000.";
  const hoaMonthlyCents = s.hoa.trim() ? dollarsToCents(s.hoa) : 0;
  if (hoaMonthlyCents === null) errors.hoaMonthlyCents = "Enter a dollar amount.";
  const taxAnnualCents = s.tax.trim() ? dollarsToCents(s.tax) : 0;
  if (taxAnnualCents === null) errors.taxAnnualCents = "Enter a dollar amount.";
  const counts = { bedrooms: int(s.bedrooms), fullBaths: int(s.fullBaths), halfBaths: int(s.halfBaths), livingAreaSqft: int(s.livingAreaSqft), lotSizeSqft: int(s.lotSizeSqft), yearBuilt: int(s.yearBuilt) };
  for (const [k, v] of Object.entries(counts)) if (Number.isNaN(v)) errors[k] = "Whole numbers only.";
  const latitude = num(s.latitude);
  const longitude = num(s.longitude);
  if ((latitude === null) !== (longitude === null)) errors.latitude = "Provide both coordinates (or neither).";
  if (latitude !== null && (Number.isNaN(latitude) || latitude < -90 || latitude > 90)) errors.latitude = "Latitude must be between -90 and 90.";
  if (longitude !== null && (Number.isNaN(longitude) || longitude < -180 || longitude > 180)) errors.longitude = "Longitude must be between -180 and 180.";
  if (Object.keys(errors).length) return { errors };

  return {
    errors,
    metadata: {
      title: s.title.trim(),
      headline: s.headline.trim() || null,
      description: s.description.trim(),
      addressLine: s.addressLine.trim(),
      city: s.city.trim(),
      state: s.state.trim().toUpperCase(),
      postalCode: s.postalCode.trim(),
      latitude,
      longitude,
      status: s.status,
      listingType: s.listingType,
      priceCents,
      hoaMonthlyCents,
      taxAnnualCents,
      bedrooms: counts.bedrooms ?? 0,
      fullBaths: counts.fullBaths ?? 0,
      halfBaths: counts.halfBaths ?? 0,
      livingAreaSqft: counts.livingAreaSqft,
      lotSizeSqft: counts.lotSizeSqft,
      yearBuilt: counts.yearBuilt,
      isFeatured: s.isFeatured,
      amenities: s.amenities,
      structuralFeatures: Object.fromEntries(s.features.filter((f) => f.key.trim() && f.value.trim()).map((f) => [f.key.trim(), f.value.trim()])),
    },
  };
}

export function ListingForm({ listing, onSaved }: { listing?: ListingDetail; onSaved?: () => void | Promise<void> }) {
  const router = useRouter();
  const [s, setS] = useState<FormState>(() => fromListing(listing));
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [coverId, setCoverId] = useState<string | null>(null);
  const [amenity, setAmenity] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [saved, setSaved] = useState<{ slug: string; status: string } | null>(null);
  const [locating, setLocating] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setS((prev) => ({ ...prev, [k]: v }));
  const text = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(k, e.target.value as never);
  const err = (k: string) => errors[k];

  async function locate() {
    setLocating(true);
    try {
      const q = encodeURIComponent(`${s.addressLine}, ${s.city}, ${s.state} ${s.postalCode}`);
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${q}`, { headers: { Accept: "application/json" } });
      const [hit] = (await res.json()) as { lat: string; lon: string }[];
      if (hit) {
        setS((prev) => ({ ...prev, latitude: Number(hit.lat).toFixed(6), longitude: Number(hit.lon).toFixed(6) }));
        setErrors((e) => ({ ...e, latitude: "", longitude: "" }));
      } else setErrors((e) => ({ ...e, latitude: "Address not found — enter coordinates manually." }));
    } catch {
      setErrors((e) => ({ ...e, latitude: "Lookup unavailable — enter coordinates manually." }));
    } finally {
      setLocating(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    const { metadata, errors: clientErrors } = toMetadata(s);
    setErrors(clientErrors);
    if (!metadata) {
      setMessage("Please fix the highlighted fields.");
      return;
    }
    if (!listing && photos.length === 0) {
      setErrors({ files: "Add at least one photo." });
      setMessage("Add at least one photo to create a listing.");
      return;
    }
    try {
      let result: { property: { id: string; slug: string; status: string } };
      if (photos.length || !listing) {
        setProgress(0);
        result = await uploadListing({ propertyId: listing?.id, metadata, photos, coverId }, setProgress);
      } else {
        result = await api(`/api/properties/${listing.id}`, { method: "PATCH", body: metadata });
      }
      photos.forEach((p) => URL.revokeObjectURL(p.preview));
      setPhotos([]);
      setCoverId(null);
      setSaved({ slug: result.property.slug, status: result.property.status });
      if (!listing) router.replace(`/admin/listings/${result.property.id}`);
      else await onSaved?.();
    } catch (error) {
      const fields = (error as { fields?: Record<string, string> }).fields ?? (error instanceof ApiClientError ? error.fields : {});
      setErrors(fields);
      setMessage(error instanceof Error ? error.message : "Couldn't save.");
    } finally {
      setProgress(null);
    }
  }

  const busy = progress !== null;

  return (
    <form onSubmit={submit} className="grid gap-10 lg:grid-cols-12" noValidate>
      <div className="space-y-10 lg:col-span-7">
        <section className="space-y-5 rounded-[28px] bg-paper p-6 ring-1 ring-line sm:p-8" aria-labelledby="sec-basics">
          <h2 id="sec-basics" className="type-headline">The residence</h2>
          <Field label="Title" htmlFor="l-title" error={err("title")}>
            <Input id="l-title" value={s.title} onChange={text("title")} placeholder="The Kennebec Federal" aria-invalid={Boolean(err("title"))} />
          </Field>
          <Field label="Headline" htmlFor="l-headline" error={err("headline")} hint="One sentence shown under the title.">
            <Input id="l-headline" value={s.headline} onChange={text("headline")} maxLength={200} />
          </Field>
          <Field label="Description" htmlFor="l-desc" error={err("description")} hint="Blank lines start new paragraphs.">
            <Textarea id="l-desc" value={s.description} onChange={text("description")} rows={8} />
          </Field>
        </section>

        <section className="space-y-5 rounded-[28px] bg-paper p-6 ring-1 ring-line sm:p-8" aria-labelledby="sec-address">
          <h2 id="sec-address" className="type-headline">Address</h2>
          <Field label="Street address" htmlFor="l-addr" error={err("addressLine")}>
            <Input id="l-addr" value={s.addressLine} onChange={text("addressLine")} autoComplete="street-address" aria-invalid={Boolean(err("addressLine"))} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1fr_90px_140px]">
            <Field label="Town" htmlFor="l-city" error={err("city")}>
              <Input id="l-city" value={s.city} onChange={text("city")} aria-invalid={Boolean(err("city"))} />
            </Field>
            <Field label="State" htmlFor="l-state" error={err("state")}>
              <Input id="l-state" value={s.state} onChange={text("state")} maxLength={2} />
            </Field>
            <Field label="ZIP" htmlFor="l-zip" error={err("postalCode")}>
              <Input id="l-zip" value={s.postalCode} onChange={text("postalCode")} inputMode="numeric" aria-invalid={Boolean(err("postalCode"))} />
            </Field>
          </div>
          <div className="grid items-end gap-4 sm:grid-cols-[1fr_1fr_auto]">
            <Field label="Latitude" htmlFor="l-lat" error={err("latitude")}>
              <Input id="l-lat" value={s.latitude} onChange={text("latitude")} inputMode="decimal" />
            </Field>
            <Field label="Longitude" htmlFor="l-lng" error={err("longitude")}>
              <Input id="l-lng" value={s.longitude} onChange={text("longitude")} inputMode="decimal" />
            </Field>
            <Button type="button" variant="outline" onClick={locate} disabled={locating || !s.addressLine}>
              <MapPin /> {locating ? "Finding…" : "Find"}
            </Button>
          </div>
          <p className="text-[0.8125rem] text-ink-3">Coordinates place the pin on the map and compute the school district and Walk Index automatically.</p>
        </section>

        <section className="space-y-5 rounded-[28px] bg-paper p-6 ring-1 ring-line sm:p-8" aria-labelledby="sec-features">
          <h2 id="sec-features" className="type-headline">Amenities &amp; structure</h2>
          <div>
            <label htmlFor="l-amenity" className="text-[0.8125rem] font-medium text-ink-2">Amenities</label>
            <div className="mt-1.5 flex gap-2">
              <Input
                id="l-amenity"
                value={amenity}
                onChange={(e) => setAmenity(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (amenity.trim() && !s.amenities.includes(amenity.trim())) set("amenities", [...s.amenities, amenity.trim()]);
                    setAmenity("");
                  }
                }}
                placeholder="Type and press Enter — e.g. Private dock"
                maxLength={60}
              />
            </div>
            <ul className="mt-3 flex flex-wrap gap-2">
              {s.amenities.map((a) => (
                <li key={a}>
                  <button type="button" onClick={() => set("amenities", s.amenities.filter((x) => x !== a))} className="pressable rounded-full bg-fill px-3 py-1.5 text-[0.8125rem]" aria-label={`Remove ${a}`}>
                    {a} ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[0.8125rem] font-medium text-ink-2">Structural features</p>
            <ul className="mt-2 space-y-2">
              {s.features.map((f, i) => (
                <li key={i} className="grid grid-cols-[160px_1fr_auto] gap-2">
                  <Input aria-label="Feature" value={f.key} onChange={(e) => set("features", s.features.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} placeholder="Roof" />
                  <Input aria-label={`${f.key || "Feature"} detail`} value={f.value} onChange={(e) => set("features", s.features.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder="Standing-seam metal (2021)" />
                  <Button type="button" variant="ghost" size="icon" onClick={() => set("features", s.features.filter((_, j) => j !== i))} aria-label="Remove feature"><Trash2 /></Button>
                </li>
              ))}
            </ul>
            <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => set("features", [...s.features, { key: "", value: "" }])}><Plus /> Add feature</Button>
          </div>
        </section>

        <section className="rounded-[28px] bg-paper p-6 ring-1 ring-line sm:p-8" aria-labelledby="sec-photos">
          <h2 id="sec-photos" className="type-headline">{listing ? "Add photos" : "Photos"}</h2>
          {listing && listing.media.length > 0 && <p className="mt-1 text-sm text-ink-2">{listing.media.length} photos already published. New photos are added after them.</p>}
          <div className="mt-5">
            <PhotoUploader photos={photos} onChange={setPhotos} coverId={coverId} onCoverChange={setCoverId} disabled={busy} />
          </div>
          {err("files") && <p className="mt-3 text-sm text-danger">{err("files")}</p>}
        </section>
      </div>

      <aside className="lg:col-span-5">
        <div className="sticky top-32 space-y-5 rounded-[28px] bg-paper p-6 ring-1 ring-line sm:p-8">
          <h2 className="type-headline">Listing</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status" htmlFor="l-status">
              <Select id="l-status" value={s.status} onChange={text("status")}>
                <option value="draft">Draft (hidden)</option>
                <option value="active">Active</option>
                <option value="pending">Under contract</option>
                <option value="sold">Sold</option>
                <option value="off_market">Off market</option>
              </Select>
            </Field>
            <Field label="Type" htmlFor="l-type">
              <Select id="l-type" value={s.listingType} onChange={text("listingType")}>
                <option value="sale">For sale</option>
                <option value="rent">For lease</option>
              </Select>
            </Field>
          </div>
          <Field label={s.listingType === "rent" ? "Monthly rent ($)" : "Price ($)"} htmlFor="l-price" error={err("priceCents")} hint="Stored exactly, in cents.">
            <Input id="l-price" value={s.price} onChange={text("price")} inputMode="decimal" placeholder="1,250,000" aria-invalid={Boolean(err("priceCents"))} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Annual taxes ($)" htmlFor="l-tax" error={err("taxAnnualCents")}>
              <Input id="l-tax" value={s.tax} onChange={text("tax")} inputMode="decimal" />
            </Field>
            <Field label="HOA / month ($)" htmlFor="l-hoa" error={err("hoaMonthlyCents")}>
              <Input id="l-hoa" value={s.hoa} onChange={text("hoa")} inputMode="decimal" />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Beds" htmlFor="l-beds" error={err("bedrooms")}><Input id="l-beds" value={s.bedrooms} onChange={text("bedrooms")} inputMode="numeric" /></Field>
            <Field label="Full baths" htmlFor="l-fb" error={err("fullBaths")}><Input id="l-fb" value={s.fullBaths} onChange={text("fullBaths")} inputMode="numeric" /></Field>
            <Field label="Half baths" htmlFor="l-hb" error={err("halfBaths")}><Input id="l-hb" value={s.halfBaths} onChange={text("halfBaths")} inputMode="numeric" /></Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Interior sq ft" htmlFor="l-sqft" error={err("livingAreaSqft")}><Input id="l-sqft" value={s.livingAreaSqft} onChange={text("livingAreaSqft")} inputMode="numeric" /></Field>
            <Field label="Lot sq ft" htmlFor="l-lot" error={err("lotSizeSqft")}><Input id="l-lot" value={s.lotSizeSqft} onChange={text("lotSizeSqft")} inputMode="numeric" /></Field>
            <Field label="Year built" htmlFor="l-year" error={err("yearBuilt")}><Input id="l-year" value={s.yearBuilt} onChange={text("yearBuilt")} inputMode="numeric" /></Field>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            Feature on the home page
            <Switch checked={s.isFeatured} onCheckedChange={(v) => set("isFeatured", v)} aria-label="Feature on the home page" />
          </label>
          {message && <p className="text-sm text-danger" role="alert">{message}</p>}
          {saved && !message && (
            <p className="rounded-2xl bg-success-bg p-3 text-sm text-success" role="status">
              Saved{saved.status !== "draft" ? " — live on the site now" : " as a draft"}.{" "}
              {saved.status !== "draft" && <Link href={`/listings/${saved.slug}`} target="_blank" className="underline">View →</Link>}
            </p>
          )}
          <UploadProgress value={progress} />
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? "Publishing…" : listing ? (photos.length ? `Save & upload ${photos.length} photo${photos.length === 1 ? "" : "s"}` : "Save changes") : s.status === "draft" ? "Save draft" : "Publish listing"}
          </Button>
        </div>
      </aside>
    </form>
  );
}
