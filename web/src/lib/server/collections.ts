import "server-only";
import type { Collection, CollectionComment, CollectionItem, Reaction, UserRole, Viewer } from "@/lib/types";
import { withDb, type DbContext } from "./db";
import { notFound } from "./errors";
import { COVER_JOIN, LISTING_COLUMNS, toListingCard, type ListingRow } from "./serializers";

/**
 * Compass-style collections. A client saves homes into named collections,
 * reacts (love / maybe / pass), leaves notes and comments; their assigned
 * agent sees the same collection and replies. Every write fires a NOTIFY, so
 * both sides update live over /api/events. RLS (app_can_access_collection)
 * guarantees nobody else can read them.
 */

interface CollectionRow {
  id: string;
  name: string;
  owner_id: string;
  owner_name: string;
  agent_id: string | null;
  agent_name: string | null;
  agent_photo: string | null;
  updated_at: Date;
}

async function hydrate(context: DbContext, rows: CollectionRow[]): Promise<Collection[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  return withDb(context, async (db) => {
    const items = await db.query<ListingRow & { collection_id: string; reaction: Reaction | null; note: string | null; added_at: Date }>(
      `SELECT ci.collection_id, ci.reaction, ci.note, ci.created_at AS added_at, ${LISTING_COLUMNS}
         FROM collection_items ci
         JOIN properties p ON p.id = ci.property_id
         ${COVER_JOIN}
        WHERE ci.collection_id = ANY($1::uuid[])
        ORDER BY ci.created_at DESC`,
      [ids],
    );
    const comments = await db.query<{
      id: string;
      collection_id: string;
      property_id: string | null;
      author_id: string;
      author_name: string;
      author_role: UserRole;
      body: string;
      created_at: Date;
    }>(
      `SELECT c.id, c.collection_id, c.property_id, c.author_id, u.full_name AS author_name, u.role AS author_role,
              c.body, c.created_at
         FROM collection_comments c
         JOIN users u ON u.id = c.author_id
        WHERE c.collection_id = ANY($1::uuid[])
        ORDER BY c.created_at ASC`,
      [ids],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      agent: r.agent_id ? { id: r.agent_id, fullName: r.agent_name ?? "Your agent", photoUrl: r.agent_photo } : null,
      updatedAt: r.updated_at.toISOString(),
      items: items
        .filter((i) => i.collection_id === r.id)
        .map(
          (i): CollectionItem => ({
            listing: toListingCard(i),
            reaction: i.reaction,
            note: i.note,
            addedAt: i.added_at.toISOString(),
          }),
        ),
      comments: comments
        .filter((c) => c.collection_id === r.id)
        .map(
          (c): CollectionComment => ({
            id: c.id,
            propertyId: c.property_id,
            authorId: c.author_id,
            authorName: c.author_name,
            authorRole: c.author_role,
            body: c.body,
            createdAt: c.created_at.toISOString(),
          }),
        ),
    }));
  });
}

const COLLECTION_SELECT = `
  SELECT c.id, c.name, c.owner_id, o.full_name AS owner_name, c.agent_id, a.full_name AS agent_name,
         a.photo_url AS agent_photo, c.updated_at
    FROM collections c
    JOIN users o ON o.id = c.owner_id
    LEFT JOIN users a ON a.id = c.agent_id`;

/** Every collection the caller can see (own collections for clients; their clients' for agents). */
export async function listCollections(context: DbContext): Promise<Collection[]> {
  const rows = await withDb(context, (db) => db.query<CollectionRow>(`${COLLECTION_SELECT} ORDER BY c.updated_at DESC LIMIT 100`));
  return hydrate(context, rows);
}

export async function getCollection(context: DbContext, id: string): Promise<Collection> {
  const row = await withDb(context, (db) => db.one<CollectionRow>(`${COLLECTION_SELECT} WHERE c.id = $1`, [id]));
  if (!row) throw notFound("Collection");
  return (await hydrate(context, [row]))[0];
}

/** Create a collection owned by the viewer and shared with their assigned agent. */
export async function createCollection(context: DbContext, viewer: Viewer, name: string): Promise<Collection> {
  const id = crypto.randomUUID();
  await withDb(context, (db) =>
    db.query("INSERT INTO collections (id, owner_id, agent_id, name) VALUES ($1, $2, $3, $4)", [id, viewer.id, viewer.assignedAgentId, name]),
  );
  return getCollection(context, id);
}

/** The viewer's default collection ("Saved homes"), created on first use. */
export async function ensureDefaultCollection(context: DbContext, viewer: Viewer): Promise<string> {
  const existing = await withDb(context, (db) =>
    db.one<{ id: string }>("SELECT id FROM collections WHERE owner_id = $1 ORDER BY created_at LIMIT 1", [viewer.id]),
  );
  if (existing) return existing.id;
  return (await createCollection(context, viewer, "Saved homes")).id;
}

export async function upsertItem(
  context: DbContext,
  viewer: Viewer,
  collectionId: string,
  input: { propertyId: string; reaction?: Reaction | null; note?: string | null },
): Promise<void> {
  await withDb(context, async (db) => {
    const visible = await db.one("SELECT 1 FROM collections WHERE id = $1", [collectionId]);
    if (!visible) throw notFound("Collection");
    await db.query(
      `INSERT INTO collection_items (collection_id, property_id, reaction, note, added_by)
       VALUES ($1, $2, $3::item_reaction, $4, $5)
       ON CONFLICT (collection_id, property_id) DO UPDATE
         SET reaction = CASE WHEN $6 THEN EXCLUDED.reaction ELSE collection_items.reaction END,
             note = CASE WHEN $7 THEN EXCLUDED.note ELSE collection_items.note END`,
      [collectionId, input.propertyId, input.reaction ?? null, input.note ?? null, viewer.id, input.reaction !== undefined, input.note !== undefined],
    );
  });
}

export async function removeItem(context: DbContext, collectionId: string, propertyId: string): Promise<void> {
  await withDb(context, (db) => db.query("DELETE FROM collection_items WHERE collection_id = $1 AND property_id = $2", [collectionId, propertyId]));
}

export async function addComment(
  context: DbContext,
  viewer: Viewer,
  collectionId: string,
  input: { body: string; propertyId?: string | null },
): Promise<void> {
  await withDb(context, async (db) => {
    const visible = await db.one("SELECT 1 FROM collections WHERE id = $1", [collectionId]);
    if (!visible) throw notFound("Collection");
    await db.query("INSERT INTO collection_comments (collection_id, property_id, author_id, body) VALUES ($1, $2, $3, $4)", [
      collectionId,
      input.propertyId ?? null,
      viewer.id,
      input.body,
    ]);
  });
}

/** Ids of listings the viewer has saved in any collection (to show filled hearts). */
export async function savedPropertyIds(context: DbContext, viewer: Viewer): Promise<string[]> {
  const rows = await withDb(context, (db) =>
    db.query<{ property_id: string }>(
      `SELECT DISTINCT ci.property_id FROM collection_items ci JOIN collections c ON c.id = ci.collection_id WHERE c.owner_id = $1`,
      [viewer.id],
    ),
  );
  return rows.map((r) => r.property_id);
}
