import { expect, test } from "@playwright/test";
import { signIn } from "../helpers";

/** Listing management in the portal. */
test("the listings table loads for staff", async ({ page }) => {
  await signIn(page.request, "owner");
  await page.goto("/admin/listings");
  await expect(page.getByText("Orchard Hill Farmhouse").first()).toBeVisible();
});

test("editing one field of a listing leaves the rest unchanged (regression)", async ({ request }) => {
  await signIn(request, "owner");
  const { listings } = await (await request.get("/api/properties?limit=50")).json();
  const farm = listings.find((l: { slug: string }) => l.slug === "orchard-hill-farmhouse-sidney");
  const before = (await (await request.get(`/api/properties/${farm.id}`)).json()).property;
  const res = await request.patch(`/api/properties/${farm.id}`, { data: { headline: before.headline }, headers: { Origin: "http://localhost:3100" } });
  expect(res.status()).toBe(200);
  const after = (await (await request.get(`/api/properties/${farm.id}`)).json()).property;
  expect(after.status).toBe(before.status);
  expect(after.amenities).toEqual(before.amenities);
  expect(after.garageSpaces).toBe(before.garageSpaces);
});

test("the farmhouse listing has its exterior photo as the cover", async ({ page }) => {
  await page.goto("/listings/orchard-hill-farmhouse-sidney");
  await expect(page.getByRole("img", { name: /Red barns and a farmhouse/ }).first()).toBeVisible();
});
