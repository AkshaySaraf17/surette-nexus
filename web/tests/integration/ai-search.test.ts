import { afterAll, describe, expect, it } from "vitest";
import { contentHash, listingTexts } from "@/lib/server/ai-index";
import { ANONYMOUS, getPool, withDb, withSystemDb } from "@/lib/server/db";
import { EMBED_DIM, toVector } from "@/lib/server/ml-client";
import { fuse } from "@/lib/server/rank";
import { siteTeamId, testTag } from "../helpers/db";

/** Vector search tables: who can read which passages (row-level security), plus ranking helpers. */
const tag = testTag("ai");
const vec = (x: number) => toVector(Array.from({ length: EMBED_DIM }, (_, i) => (i === 0 ? x : 0.001)));

afterAll(async () => {
  await withSystemDb(async (db) => {
    await db.query("DELETE FROM transactions WHERE title LIKE $1", [`${tag}%`]);
    await db.query("DELETE FROM properties WHERE slug LIKE $1", [`${tag}%`]);
    await db.query("DELETE FROM users WHERE email LIKE $1", [`${tag}%`]);
  });
  await getPool().end();
});

async function agent(name: string) {
  const teamId = await siteTeamId();
  const row = await withSystemDb((db) => db.one<{ id: string }>("INSERT INTO users (email, password_hash, full_name, role, team_id) VALUES ($1, 'x', $2, 'agent', $3) RETURNING id", [`${tag}-${name}@example.com`, name, teamId]));
  return { userId: row!.id, role: "agent" as const, teamId };
}

describe("document_chunks row-level security", () => {
  it("only the deal's agent (or an admin) can retrieve its passages", async () => {
    const a = await agent("a");
    const b = await agent("b");
    const docId = await withSystemDb(async (db) => {
      const t = await db.one<{ id: string }>("INSERT INTO transactions (team_id, title, side, client_name, agent_id) VALUES ($1, $2, 'buyer', 'Test Client', $3) RETURNING id", [a.teamId, `${tag} deal`, a.userId]);
      const d = await db.one<{ id: string }>(
        "INSERT INTO transaction_documents (transaction_id, label, file_name, mime_type, bytes, sha256, storage_key) VALUES ($1, 'P&S', 'ps.txt', 'text/plain', 10, $2, $3) RETURNING id",
        [t!.id, "a".repeat(64), `deals/${t!.id}/${tag}`],
      );
      await db.query("INSERT INTO document_chunks (document_id, transaction_id, page, ord, content, embedding, model) VALUES ($1, $2, 1, 0, 'The purchase price is $325,000.', $3::vector, 'test')", [d!.id, t!.id, vec(0.9)]);
      return d!.id;
    });
    const count = (ctx: Parameters<typeof withDb>[0]) => withDb(ctx, async (db) => (await db.query("SELECT 1 FROM document_chunks WHERE document_id = $1", [docId])).length);
    expect(await count(a)).toBe(1);
    expect(await count(b)).toBe(0);
    expect(await count(ANONYMOUS)).toBe(0);
    // The app role can read passages but never write them (only the worker's system role can).
    await expect(withDb(a, (db) => db.query("DELETE FROM document_chunks WHERE document_id = $1", [docId]))).rejects.toThrow(/permission denied/);
  });
});

describe("property_chunks row-level security", () => {
  it("passages of a draft listing are hidden from the public search", async () => {
    const teamId = await siteTeamId();
    const propertyId = await withSystemDb(async (db) => {
      const p = await db.one<{ id: string }>(
        "INSERT INTO properties (team_id, slug, title, address_line, city, postal_code, price_cents) VALUES ($1, $2, 'Draft test home', '1 Test St', 'Waterville', '04901', 100000) RETURNING id",
        [teamId, `${tag}-draft`],
      );
      await db.query("INSERT INTO property_chunks (property_id, ord, content, embedding, model) VALUES ($1, 0, 'secret draft', $2::vector, 'test')", [p!.id, vec(0.5)]);
      return p!.id;
    });
    const visible = await withDb(ANONYMOUS, (db) => db.query("SELECT 1 FROM property_chunks WHERE property_id = $1", [propertyId]));
    expect(visible).toHaveLength(0);
  });
});

describe("ranking helpers", () => {
  it("reciprocal-rank fusion favours items ranked well by both lists", () => {
    const a = { id: "a" }, b = { id: "b" }, c = { id: "c" };
    expect(fuse([[a, b, c], [b, c, a]], 3).map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(fuse([[a], []], 5)).toEqual([a]);
  });

  it("a listing is re-embedded only when its searchable text or the model changes", () => {
    const p = { id: "1", title: "Lake House", headline: null, description: "Sunset views.", city: "Oakland", property_type: "single_family", listing_type: "sale", bedrooms: 3, full_baths: 2, half_baths: 0, living_area_sqft: 2000, lot_size_sqft: null, year_built: 2012, amenities: ["Dock"], structural_features: {}, school_district: null, ai_content_hash: null };
    const h = contentHash(p, "m1");
    expect(contentHash({ ...p, ai_content_hash: "anything" }, "m1")).toBe(h);
    expect(contentHash({ ...p, description: "Sunrise views." }, "m1")).not.toBe(h);
    expect(contentHash(p, "m2")).not.toBe(h);
    expect(listingTexts(p).summary).toContain("single family for sale in Oakland, Maine, 3 bedrooms, 2 bathrooms");
  });

  it("vectors must have the model's dimension", () => {
    expect(() => toVector([0.1, 0.2])).toThrow();
    expect(toVector(Array(EMBED_DIM).fill(0)).startsWith("[0,0")).toBe(true);
  });
});
