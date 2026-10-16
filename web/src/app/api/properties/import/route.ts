import { contextFor, requireStaff } from "@/lib/server/auth";
import { withDb } from "@/lib/server/db";
import { ApiError, handler, zodFields } from "@/lib/server/http";
import { createListing, updateListing } from "@/lib/server/listing-writes";
import { listingInputSchema } from "@/lib/validation";
import { dollarsToCents } from "@/lib/money";

/**
 * POST /api/properties/import — bulk-create or update listings from a CSV the brokerage supplies
 * (text/csv body, header row). Rows are validated like the listing form; every row reports its
 * outcome. Imported listings are drafts unless the CSV says otherwise, and keep source = csv_import
 * plus the row's `source_ref` (e.g. MLS number) so re-importing updates instead of duplicating.
 *
 * Columns: source_ref,title,address,city,state,zip,price,status,listing_type,property_type,bedrooms,
 *          full_baths,half_baths,sqft,lot_sqft,year_built,garage_spaces,latitude,longitude,description,amenities
 * (price in dollars; amenities separated by "|").
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export const POST = handler(async (request: Request) => {
  const viewer = await requireStaff(request);
  const text = await request.text();
  if (text.length > 2_000_000) throw new ApiError(413, "TOO_LARGE", "CSV files can be up to 2 MB (about 5,000 rows).");
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (rows.length < 2) throw new ApiError(400, "EMPTY_CSV", "The CSV needs a header row and at least one listing.");
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (r: string[], name: string) => r[header.indexOf(name)]?.trim() ?? "";
  if (!header.includes("title") || !header.includes("price")) throw new ApiError(400, "BAD_HEADER", "The header must include at least title, address, city, zip and price.");
  const num = (v: string) => (v === "" ? undefined : Number(v.replace(/,/g, "")));
  const results: { row: number; status: "created" | "updated" | "error"; title: string; message?: string }[] = [];
  const ctx = contextFor(viewer);
  for (const [i, r] of rows.slice(1, 5001).entries()) {
    const priceCents = dollarsToCents(col(r, "price"));
    const candidate = {
      title: col(r, "title"),
      addressLine: col(r, "address"),
      city: col(r, "city"),
      state: col(r, "state") || "ME",
      postalCode: col(r, "zip"),
      priceCents: priceCents ?? -1,
      status: col(r, "status") || "draft",
      listingType: col(r, "listing_type") || "sale",
      propertyType: col(r, "property_type") || "single_family",
      bedrooms: num(col(r, "bedrooms")) ?? 0,
      fullBaths: num(col(r, "full_baths")) ?? 0,
      halfBaths: num(col(r, "half_baths")) ?? 0,
      livingAreaSqft: num(col(r, "sqft")) ?? null,
      lotSizeSqft: num(col(r, "lot_sqft")) ?? null,
      yearBuilt: num(col(r, "year_built")) ?? null,
      garageSpaces: num(col(r, "garage_spaces")) ?? 0,
      latitude: num(col(r, "latitude")) ?? null,
      longitude: num(col(r, "longitude")) ?? null,
      description: col(r, "description"),
      amenities: col(r, "amenities") ? col(r, "amenities").split("|").map((a) => a.trim()).filter(Boolean) : [],
    };
    const parsed = listingInputSchema.safeParse(candidate);
    if (!parsed.success) {
      results.push({ row: i + 2, status: "error", title: candidate.title || "(no title)", message: Object.entries(zodFields(parsed.error)).map(([k, v]) => `${k}: ${v}`).join("; ") });
      continue;
    }
    const ref = col(r, "source_ref") || null;
    try {
      const outcome = await withDb(ctx, async (db) => {
        const existing = ref ? await db.one<{ id: string }>("SELECT id FROM properties WHERE team_id = $1 AND source = 'csv_import' AND source_ref = $2", [viewer.teamId, ref]) : null;
        if (existing) {
          await updateListing(db, existing.id, parsed.data);
          return "updated" as const;
        }
        const created = await createListing(db, viewer, parsed.data);
        await db.query("UPDATE properties SET source = 'csv_import', source_ref = $2 WHERE id = $1", [created.id, ref]);
        return "created" as const;
      });
      results.push({ row: i + 2, status: outcome, title: parsed.data.title });
    } catch (error) {
      results.push({ row: i + 2, status: "error", title: parsed.data.title, message: error instanceof Error ? error.message : "Couldn't save" });
    }
  }
  return Response.json({ results, created: results.filter((r) => r.status === "created").length, updated: results.filter((r) => r.status === "updated").length, errors: results.filter((r) => r.status === "error").length });
});
