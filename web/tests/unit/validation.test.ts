import { describe, expect, it } from "vitest";
import { listingInputSchema, listingPatchSchema } from "@/lib/validation";

describe("listing patch schema", () => {
  it("keeps only the fields that were sent (regression: zod v4 .partial() kept defaults)", () => {
    // Before the fix, this patch silently became { headline, status: "draft", amenities: [], … } and unpublished the listing.
    expect(listingPatchSchema.parse({ headline: "New headline" })).toEqual({ headline: "New headline" });
    expect(listingPatchSchema.parse({})).toEqual({});
    expect(listingPatchSchema.parse({ status: "active" })).toEqual({ status: "active" });
  });

  it("still validates the fields it receives", () => {
    expect(listingPatchSchema.safeParse({ priceCents: 410.67 }).success).toBe(false);
    expect(listingPatchSchema.safeParse({ status: "published" }).success).toBe(false);
    expect(listingPatchSchema.safeParse({ state: "Maine" }).success).toBe(false);
  });

  it("creating a listing still applies the defaults", () => {
    const created = listingInputSchema.parse({ title: "Test home", addressLine: "1 Main St", city: "Waterville", postalCode: "04901", priceCents: 30_000_000 });
    expect(created.status).toBe("draft");
    expect(created.state).toBe("ME");
    expect(created.amenities).toEqual([]);
  });
});
