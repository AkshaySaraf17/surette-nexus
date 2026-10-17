/**
 * Development seed: the Surette Real Estate team, its leader, demo logins and
 * DEMO listings (fictional addresses, freely licensed photos — see
 * src/content/credits.json). Photos go through the same optimization pipeline
 * as real uploads. Re-running wipes and recreates the demo data.
 *
 *   npm run db:seed          (scripts/db.sh reset runs it for you)
 *
 * Demo logins (LOCAL DEVELOPMENT ONLY — never run this seed in production; create the
 * real owner account with `npm run admin:create` instead):
 *   Property management:  owner@surette.test  / surette-owner-2026   (owner / admin)
 *                         agent@surette.test  / surette-agent-2026   (agent)
 *   Customer:             client@surette.test / surette-client-2026
 *
 * Every demo listing is stored with source = 'demo' and labeled "Demo listing" in the UI.
 */
import { createReadStream, existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { getPool, withSystemDb } from "../src/lib/server/db";
import { importSnapshots } from "../src/lib/server/gov-data";
import { closeRedis } from "../src/lib/server/redis";
import bcrypt from "bcryptjs";
import { processImageStream, storageRoot } from "../src/lib/server/media";
import { districtFor, walkIndex } from "../src/lib/geo";
import { DEFAULT_TEMPLATES, resolveTemplate, type DealSide } from "../src/lib/deal-rules";

const PHOTOS = path.join(__dirname, "seed-photos");

interface SeedListing {
  slug: string;
  title: string;
  headline: string;
  description: string;
  addressLine: string;
  city: string;
  postalCode: string;
  position: [number, number];
  status: "active" | "pending" | "sold";
  listingType: "sale" | "rent";
  priceCents: number;
  taxAnnualCents: number;
  hoaMonthlyCents?: number;
  bedrooms: number;
  fullBaths: number;
  halfBaths: number;
  livingAreaSqft: number;
  lotSizeSqft: number | null;
  yearBuilt: number;
  amenities: string[];
  structuralFeatures: Record<string, string>;
  featured?: boolean;
  propertyType?: "single_family" | "condo" | "apartment" | "multi_family";
  garageSpaces?: number;
  photos: { file: string; alt: string }[];
}

const LISTINGS: SeedListing[] = [
  {
    slug: "kennebec-federal-colonial-waterville",
    garageSpaces: 2,
    title: "The Kennebec Federal",
    headline: "A restored 1790s Federal colonial a short walk from Main Street.",
    description:
      "Set back behind a deep lawn, this five-bedroom Federal colonial pairs period detail — wide-plank floors, carved mantels, a grand formal dining room — with a modern mechanical core. The great room opens onto a stone terrace; the primary suite has a freestanding soaking tub beneath twin windows. Minutes on foot to the RiverWalk, the Schupf Art Center and Colby's shuttle.",
    addressLine: "18 Elm Terrace",
    city: "Waterville",
    postalCode: "04901",
    position: [-69.6372, 44.5545],
    status: "active",
    listingType: "sale",
    priceCents: 124_500_000,
    taxAnnualCents: 1_684_200,
    bedrooms: 5,
    fullBaths: 3,
    halfBaths: 1,
    livingAreaSqft: 4_280,
    lotSizeSqft: 43_560,
    yearBuilt: 1794,
    amenities: ["Formal dining room", "Five fireplaces", "Stone terrace", "Detached carriage barn", "Mudroom", "Walk to downtown"],
    structuralFeatures: {
      Foundation: "Fieldstone, reinforced 2019",
      Roof: "Cedar shake (2021)",
      Heating: "Hydronic radiant + heat pumps",
      Electrical: "200 A service, fully rewired",
      Windows: "Restored true divided-lite with storms",
    },
    featured: true,
    photos: [
      { file: "colonial-exterior", alt: "Federal colonial facade with symmetrical windows and a pedimented entry" },
      { file: "colonial-living", alt: "Great room with walls of windows and mid-century furniture" },
      { file: "colonial-dining", alt: "Formal dining room set for twelve" },
      { file: "colonial-bedroom", alt: "Primary bedroom with a canopy bed" },
      { file: "colonial-bath", alt: "Primary bath with a freestanding soaking tub" },
    ],
  },
  {
    slug: "messalonskee-lake-house-oakland",
    garageSpaces: 2,
    title: "Messalonskee Lake House",
    headline: "220 feet of private frontage with sunset views across the water.",
    description:
      "A glass-walled lake house built for long Maine summers and bright winter mornings. The sunroom wraps three sides of the living space, a lounge looks straight down the lake, and the lower level opens onto a granite patio and deep-water dock. Messalonskee schools; fifteen minutes to downtown Waterville.",
    addressLine: "604 Lakeview Drive",
    city: "Oakland",
    postalCode: "04963",
    position: [-69.7372, 44.5532],
    status: "active",
    listingType: "sale",
    priceCents: 189_000_000,
    taxAnnualCents: 2_215_000,
    bedrooms: 4,
    fullBaths: 3,
    halfBaths: 1,
    livingAreaSqft: 3_650,
    lotSizeSqft: 61_000,
    yearBuilt: 2012,
    amenities: ["Private dock", "220 ft frontage", "Wraparound sunroom", "Granite patio", "Two-car garage", "Generator"],
    structuralFeatures: {
      Foundation: "Poured concrete, walk-out",
      Roof: "Standing-seam metal",
      Heating: "Geothermal with radiant floors",
      Water: "Drilled well with filtration",
      Septic: "Engineered system (2012)",
    },
    featured: true,
    photos: [
      { file: "lake-view", alt: "Still lake at sunrise with a small island of pines" },
      { file: "lake-sunroom", alt: "Wood-paneled sunroom with built-in window seats overlooking the water" },
      { file: "lake-lounge", alt: "Lounge with a picture window and water view" },
      { file: "lake-bath", alt: "Bath with soaking tub and views over the water" },
      { file: "lake-foliage", alt: "Autumn foliage reflected on the lake" },
    ],
  },
  {
    slug: "orchard-hill-farmhouse-sidney",
    garageSpaces: 1,
    title: "Orchard Hill Farmhouse",
    headline: "A white clapboard farmhouse on 32 open acres with mountain views.",
    description:
      "The classic connected-farm silhouette, rebuilt inside for modern family life: a chef's kitchen, a long harvest-table dining room and four bedrooms under the eaves. The land rolls away on every side — hayfields, a kitchen garden and a red barn ready for horses or a studio.",
    addressLine: "2210 Middle Road",
    city: "Sidney",
    postalCode: "04330",
    position: [-69.7286, 44.4721],
    status: "active",
    listingType: "sale",
    priceCents: 97_500_000,
    taxAnnualCents: 921_400,
    bedrooms: 4,
    fullBaths: 2,
    halfBaths: 1,
    livingAreaSqft: 2_960,
    lotSizeSqft: 1_393_920,
    yearBuilt: 1868,
    amenities: ["32 acres", "Bank barn", "Kitchen garden", "Mountain views", "Wood stove", "Horse-ready"],
    structuralFeatures: {
      Foundation: "Granite block with concrete repairs",
      Roof: "Asphalt architectural shingle (2018)",
      Heating: "Oil hydronic + wood stove",
      Outbuildings: "Bank barn, two sheds",
    },
    featured: true,
    photos: [
      { file: "farm-exterior", alt: "Red barns and a farmhouse above open hayfields under a blue sky" },
      { file: "farm-dining", alt: "Long dining room with wood floors" },
      { file: "farm-bedroom", alt: "Sunny bedroom wrapped in windows" },
    ],
  },
  {
    slug: "silver-street-italianate-waterville",
    garageSpaces: 2,
    title: "Silver Street Italianate",
    headline: "A brick Italianate with a belvedere, in the heart of the historic district.",
    description:
      "One of Waterville's grand brick houses: twelve-foot ceilings, a library paneled in walnut, and a dining room lit by a period crystal chandelier. The belvedere reads the whole valley. Recently updated systems and a fully finished carriage-house apartment.",
    addressLine: "77 Silver Street",
    city: "Waterville",
    postalCode: "04901",
    position: [-69.6338, 44.5469],
    status: "active",
    listingType: "sale",
    priceCents: 82_900_000,
    taxAnnualCents: 1_208_800,
    bedrooms: 6,
    fullBaths: 3,
    halfBaths: 1,
    livingAreaSqft: 5_120,
    lotSizeSqft: 21_780,
    yearBuilt: 1871,
    amenities: ["Belvedere", "Library", "Carriage-house apartment", "Original plasterwork", "Walk to downtown"],
    structuralFeatures: {
      Foundation: "Granite",
      Roof: "Slate with copper flashing",
      Heating: "Gas steam (2020 boiler)",
      Exterior: "Brick, repointed 2017",
    },
    photos: [
      { file: "italianate-exterior", alt: "Red brick Italianate house with a belvedere and porch" },
      { file: "italianate-dining", alt: "Formal dining room with portraits and chandelier" },
      { file: "italianate-library", alt: "Library with built-in shelves and a brick wall" },
      { file: "italianate-bedroom", alt: "Bedroom with chandelier and tall windows" },
    ],
  },
  {
    slug: "queen-anne-on-park-street-waterville",
    garageSpaces: 1,
    title: "Queen Anne on Park",
    headline: "Turrets, wraparound porch and a quiet tree-lined street.",
    description:
      "A storybook Queen Anne with a round turret, a deep wraparound porch and a sunny eat-in kitchen. Four bedrooms upstairs plus a third-floor studio. Two blocks to the Mitchell School and a short bike ride to Colby.",
    addressLine: "41 Park Street",
    city: "Waterville",
    postalCode: "04901",
    position: [-69.6466, 44.5512],
    status: "active",
    listingType: "sale",
    priceCents: 64_900_000,
    taxAnnualCents: 846_500,
    bedrooms: 4,
    fullBaths: 2,
    halfBaths: 1,
    livingAreaSqft: 3_340,
    lotSizeSqft: 12_400,
    yearBuilt: 1898,
    amenities: ["Wraparound porch", "Turret room", "Third-floor studio", "Pocket doors", "Fenced garden"],
    structuralFeatures: { Foundation: "Brick and stone", Roof: "Asphalt shingle (2015)", Heating: "Natural gas forced air" },
    photos: [
      { file: "queenanne-exterior", alt: "Queen Anne house with turrets and a wraparound porch" },
      { file: "queenanne-bedroom", alt: "Bedroom with soft lighting" },
    ],
  },
  {
    slug: "red-barn-retreat-winslow",
    garageSpaces: 3,
    title: "Red Barn Retreat",
    headline: "A crisp red farmhouse with a three-bay garage near the Sebasticook.",
    description:
      "Freshly painted and fully landscaped, with a covered porch, a three-bay heated garage and a workshop. Open kitchen and family room, first-floor primary suite, and a short walk to Fort Halifax Park.",
    addressLine: "9 Halifax Lane",
    city: "Winslow",
    postalCode: "04901",
    position: [-69.6198, 44.5402],
    status: "active",
    listingType: "sale",
    priceCents: 54_900_000,
    taxAnnualCents: 702_300,
    bedrooms: 3,
    fullBaths: 2,
    halfBaths: 1,
    livingAreaSqft: 2_480,
    lotSizeSqft: 30_500,
    yearBuilt: 1924,
    amenities: ["Three-bay heated garage", "Workshop", "Covered porch", "First-floor primary"],
    structuralFeatures: { Foundation: "Poured concrete", Roof: "Asphalt shingle (2022)", Heating: "Heat pumps + propane" },
    photos: [{ file: "redbarn-exterior", alt: "Red farmhouse with a porch and a matching garage" }],
  },
  {
    slug: "snow-pond-shingle-style-oakland",
    garageSpaces: 0,
    title: "Snow Pond Shingle Style",
    headline: "Gambrel-roofed shingle style steps from the Messalonskee boat launch.",
    description:
      "A classic shingle-style home with a generous arched porch, original built-ins and a modern kitchen. Under contract — ask about similar homes on the lake.",
    addressLine: "12 Pond Road",
    city: "Oakland",
    postalCode: "04963",
    position: [-69.7262, 44.5444],
    status: "pending",
    listingType: "sale",
    priceCents: 71_500_000,
    taxAnnualCents: 905_000,
    bedrooms: 4,
    fullBaths: 2,
    halfBaths: 0,
    livingAreaSqft: 2_890,
    lotSizeSqft: 18_900,
    yearBuilt: 1909,
    amenities: ["Arched porch", "Built-ins", "Near boat launch"],
    structuralFeatures: { Foundation: "Fieldstone", Roof: "Asphalt shingle", Heating: "Oil hydronic" },
    photos: [{ file: "shingle-exterior", alt: "Blue shingle-style house with an arched porch in winter" }],
  },
  {
    slug: "gothic-revival-cottage-fairfield",
    garageSpaces: 0,
    title: "Gothic Revival Cottage",
    headline: "Carpenter Gothic lacework on a sunny Fairfield corner lot.",
    description: "A rare Carpenter Gothic cottage with original bargeboards and lancet windows. Recently sold by the team.",
    addressLine: "3 Lawrence Avenue",
    city: "Fairfield",
    postalCode: "04937",
    position: [-69.5986, 44.5899],
    status: "sold",
    listingType: "sale",
    priceCents: 46_000_000,
    taxAnnualCents: 512_600,
    bedrooms: 3,
    fullBaths: 2,
    halfBaths: 0,
    livingAreaSqft: 2_100,
    lotSizeSqft: 9_800,
    yearBuilt: 1856,
    amenities: ["Original millwork", "Corner lot"],
    structuralFeatures: { Foundation: "Granite", Roof: "Metal", Heating: "Heat pumps" },
    photos: [{ file: "gothic-exterior", alt: "Yellow Carpenter Gothic house with ornate trim" }],
  },
  {
    slug: "riverwalk-loft-waterville",
    garageSpaces: 0,
    propertyType: "apartment",
    title: "RiverWalk Loft",
    headline: "A mill-district loft over the Kennebec, steps from the Two Cent Bridge.",
    description:
      "Twelve-foot windows frame the river in this two-bedroom loft. Exposed brick, a chef's galley and in-unit laundry; heat and hot water included. Twelve-month lease.",
    addressLine: "2 Front Street, Unit 4B",
    city: "Waterville",
    postalCode: "04901",
    position: [-69.6289, 44.5531],
    status: "active",
    listingType: "rent",
    priceCents: 245_000,
    taxAnnualCents: 0,
    hoaMonthlyCents: 0,
    bedrooms: 2,
    fullBaths: 2,
    halfBaths: 0,
    livingAreaSqft: 1_380,
    lotSizeSqft: null,
    yearBuilt: 1902,
    amenities: ["River views", "In-unit laundry", "Heat included", "Elevator", "Bike storage"],
    structuralFeatures: { Building: "Restored brick mill", Heating: "Central gas (included)" },
    photos: [
      { file: "kennebec-river", alt: "The Kennebec River with clouds reflected on the water" },
      { file: "two-cent-bridge", alt: "The Two Cent Bridge footbridge over the Kennebec" },
      { file: "rail-bridge", alt: "Railroad bridge reflected in the river" },
    ],
  },
];

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "1") {
    throw new Error("Refusing to load demo data in production. Use `npm run admin:create` for the real owner account.");
  }
  const ownerHash = await bcrypt.hash("surette-owner-2026", 12);
  const agentHash = await bcrypt.hash("surette-agent-2026", 12);
  const clientHash = await bcrypt.hash("surette-client-2026", 12);
  const siteUrl = (process.env.PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");

  // Clean slate for the demo team (cascades to listings, media, leads, deals, analytics...).
  await withSystemDb(async (db) => {
    await db.query("DELETE FROM users WHERE email LIKE '%@surette.test'");
    await db.query("DELETE FROM agent_teams WHERE slug = 'surette'");
  });
  await rm(path.join(storageRoot(), "listings"), { recursive: true, force: true });
  await rm(path.join(storageRoot(), "deals"), { recursive: true, force: true });

  const { teamId, leaderId, agentId, clientId, ownerId } = await withSystemDb(async (db) => {
    // Public office details from surette-realestate.com.
    const team = await db.one<{ id: string }>(
      `INSERT INTO agent_teams (slug, name, market, office_phone, office_email, office_address, founded_year)
       VALUES ('surette', 'Surette Real Estate', 'Waterville & Central Maine', '+12076496893', 'jjolicoeur@surette-realestate.com',
               '113 Silver Street, Waterville, ME 04901', 1978) RETURNING id`,
    );
    const leader = await db.one<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name, role, team_id, title, bio, specialties, is_leader, is_public, sort_order, phone)
       VALUES ('jeffrey.jolicoeur@surette.test', $1, 'Jeffrey Jolicoeur', 'admin', $2, 'Team Broker & Leader',
               'Jeffrey leads the Surette Real Estate team, guiding buyers, sellers and investors across Waterville and Central Maine.',
               ARRAY['Residential', 'Waterfront', 'Investment property'], true, true, 0, '+12076496893')
       RETURNING id`,
      [ownerHash, team!.id],
    );
    const owner = await db.one<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name, role, team_id, title, is_public, sort_order)
       VALUES ('owner@surette.test', $1, 'Demo Owner', 'admin', $2, 'Owner (demo account)', false, 900) RETURNING id`,
      [ownerHash, team!.id],
    );
    const agent = await db.one<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name, role, team_id, title, is_public, sort_order)
       VALUES ('agent@surette.test', $1, 'Demo Agent', 'agent', $2, 'Agent (demo account)', false, 901) RETURNING id`,
      [agentHash, team!.id],
    );
    const client = await db.one<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name, role, team_id, assigned_agent_id)
       VALUES ('client@surette.test', $1, 'Demo Customer', 'client', $2, $3) RETURNING id`,
      [clientHash, team!.id, leader!.id],
    );
    await db.query("INSERT INTO consent_records (team_id, user_id, purpose, granted, text_version) VALUES ($1, $2, 'data_storage', true, 'privacy-2026-10')", [team!.id, client!.id]);

    // Analytics projects. The data class is fixed per project, so demo/test events never mix with production.
    await db.query(
      `INSERT INTO analytics_projects (key, team_id, name, data_class, allowed_origins) VALUES
         ('nexus-site', $1, 'Surette Nexus website', 'production', $2),
         ('demo-site', $1, 'Demo brokerage website + generator (synthetic)', 'synthetic', $2),
         ('e2e', $1, 'Automated tests', 'test', $2)
       ON CONFLICT (key) DO UPDATE SET team_id = EXCLUDED.team_id, allowed_origins = EXCLUDED.allowed_origins`,
      [team!.id, [siteUrl, "http://localhost:3100", "http://127.0.0.1:3100"]],
    );
    for (const side of Object.keys(DEFAULT_TEMPLATES) as DealSide[]) {
      await db.query("INSERT INTO task_templates (team_id, name, side, items, is_default) VALUES ($1, $2, $3::deal_side, $4, true)", [team!.id, DEFAULT_TEMPLATES[side].name, side, JSON.stringify(DEFAULT_TEMPLATES[side].items)]);
    }
    return { teamId: team!.id, leaderId: leader!.id, agentId: agent!.id, clientId: client!.id, ownerId: owner!.id };
  });

  const ids = new Map<string, string>();
  for (const listing of LISTINGS) {
    const id = crypto.randomUUID();
    ids.set(listing.slug, id);
    const district = districtFor(listing.position);
    const listingAgent = listing.slug.includes("winslow") || listing.slug.includes("fairfield") ? agentId : leaderId;
    await withSystemDb((db) =>
      db.query(
        `INSERT INTO properties (id, team_id, listing_agent_id, slug, status, listing_type, title, headline, description,
            address_line, city, state, postal_code, latitude, longitude, price_cents, hoa_monthly_cents, tax_annual_cents,
            bedrooms, full_baths, half_baths, living_area_sqft, lot_size_sqft, year_built, amenities, structural_features,
            school_district, walk_score, is_featured, created_by, property_type, garage_spaces, source)
         VALUES ($1, $2, $3, $4, $5::listing_status, $6::listing_type, $7, $8, $9, $10, $11, 'ME', $12, $13, $14, $15, $16, $17,
                 $18, $19, $20, $21, $22, $23, $24, $25::jsonb, $26, $27, $28, $3, $29::property_type, $30, 'demo')`,
        [
          id, teamId, listingAgent, listing.slug, listing.status, listing.listingType, listing.title, listing.headline, listing.description,
          listing.addressLine, listing.city, listing.postalCode, listing.position[1], listing.position[0], listing.priceCents,
          listing.hoaMonthlyCents ?? 0, listing.taxAnnualCents, listing.bedrooms, listing.fullBaths, listing.halfBaths,
          listing.livingAreaSqft, listing.lotSizeSqft, listing.yearBuilt, listing.amenities, JSON.stringify(listing.structuralFeatures),
          district?.name ?? null, walkIndex(listing.position), listing.featured ?? false, listing.propertyType ?? "single_family", listing.garageSpaces ?? 0,
        ],
      ),
    );
    for (const [index, photo] of listing.photos.entries()) {
      const file = path.join(PHOTOS, `${photo.file}.jpg`);
      if (!existsSync(file)) throw new Error(`Missing seed photo ${file}`);
      const assetId = crypto.randomUUID();
      const image = await processImageStream(createReadStream(file), `listings/${id}/${assetId}`);
      await withSystemDb((db) =>
        db.query(
          `INSERT INTO media_assets (id, property_id, kind, url, storage_key, variants, width, height, bytes, blur_data_url,
                                     alt_text, sort_order, is_cover, original_name, uploaded_by)
           VALUES ($1, $2, 'image', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [assetId, id, image.url, image.storageKey, image.variants, image.width, image.height, image.bytes, image.blurDataUrl, photo.alt, index, index === 0, `${photo.file}.jpg`, leaderId],
        ),
      );
    }
    console.log(`  ✓ ${listing.title} (${listing.photos.length} photos)`);
  }

  const loft = ids.get("riverwalk-loft-waterville")!;
  const colonial = ids.get("kennebec-federal-colonial-waterville")!;
  const lake = ids.get("messalonskee-lake-house-oakland")!;
  const farm = ids.get("orchard-hill-farmhouse-sidney")!;
  const redbarn = ids.get("red-barn-retreat-winslow")!;
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  await withSystemDb(async (db) => {
    // Utility ledger samples, including the $410.67 water bill stored as 41067 cents.
    const bills: [string, string, string, string, string, number | null, string | null, number, string | null][] = [
      [loft, "water", "Kennebec Water District", "2026-07-01", "2026-09-30", 18_420, "gallons", 41_067, "2026-10-20"],
      [loft, "electric", "Central Maine Power", "2026-09-01", "2026-09-30", 612, "kwh", 13_894, null],
      [colonial, "water", "Kennebec Water District", "2026-07-01", "2026-09-30", 31_200, "gallons", 58_212, null],
      [colonial, "electric", "Central Maine Power", "2026-09-01", "2026-09-30", 1_480, "kwh", 33_561, "2026-10-08"],
      [colonial, "heating_oil", "Dead River Company", "2026-09-15", "2026-09-15", 150, "none", 61_350, null],
    ];
    for (const [propertyId, utility, provider, start, end, usage, unit, cents, paid] of bills) {
      await db.query(
        `INSERT INTO utility_ledgers (property_id, utility, provider, period_start, period_end, usage_quantity, usage_unit, amount_cents, due_on, paid_on, recorded_by)
         VALUES ($1, $2::utility_kind, $3, $4, $5, $6, $7, $8, ($5::date + 21), $9, $10)`,
        [propertyId, utility, provider, start, end, usage, unit, cents, paid, leaderId],
      );
    }

    // A shared collection between the demo customer and Jeffrey.
    const collection = await db.one<{ id: string }>("INSERT INTO collections (owner_id, agent_id, name) VALUES ($1, $2, 'Lake & land') RETURNING id", [clientId, leaderId]);
    await db.query(
      `INSERT INTO collection_items (collection_id, property_id, reaction, note, added_by) VALUES
         ($1, $2, 'love', 'The sunroom! Could we see it on a Saturday?', $4),
         ($1, $3, 'maybe', 'Love the land — how is the commute to Augusta?', $4)`,
      [collection!.id, lake, farm, clientId],
    );
    await db.query("INSERT INTO collection_comments (collection_id, property_id, author_id, body) VALUES ($1, $2, $3, 'Saturdays work well for the lake house — I''ll send a few times.')", [collection!.id, lake, leaderId]);

    // Demo leads (each with recorded consent, as the real intake requires).
    const leads: [string, string, string, string | null, string, string | null, string, string][] = [
      ["contact_form", "Avery Demo", "avery.demo@example.com", "+12075550101", "Looking for a 3-bedroom near Colby, around $500K.", null, leaderId, "new"],
      ["showing_request", "Morgan Demo", "morgan.demo@example.com", null, "Private showing requested for the lake house.", lake, leaderId, "contacted"],
      ["ai_assistant", "Riley Demo", "riley.demo@example.com", "+12075550103", "Requested help from the website AI assistant.", redbarn, agentId, "qualified"],
    ];
    const leadIds: string[] = [];
    for (const [source, name, email, phone, message, propertyId, agent, status] of leads) {
      const row = await db.one<{ id: string }>(
        `INSERT INTO leads (team_id, source, status, contact_name, contact_email, contact_phone, message, property_id, assigned_agent_id, consent_contact, consent_text)
         VALUES ($1, $2::lead_source, $3::lead_status, $4, $5, $6, $7, $8, $9, true, 'Demo record — consent text recorded at intake.') RETURNING id`,
        [teamId, source, status, name, email, phone, message, propertyId, agent],
      );
      leadIds.push(row!.id);
      await db.query("INSERT INTO consent_records (team_id, lead_id, purpose, granted, text_version) VALUES ($1, $2, 'contact', true, 'contact-2026-10')", [teamId, row!.id]);
    }

    // Demo deals with template checklists resolved from their key dates.
    const deals: { title: string; side: DealSide; stage: string; property: string | null; client: string; clientUser: string | null; agent: string; price: number | null; bps: number | null; contract: string | null; closing: string | null; lead: string | null }[] = [
      { title: "Demo Customer — Messalonskee Lake House", side: "buyer", stage: "inspection", property: lake, client: "Demo Customer", clientUser: clientId, agent: leaderId, price: 185_000_000, bps: 250, contract: day(-8), closing: day(30), lead: leadIds[1] },
      { title: "Riley Demo — Red Barn Retreat", side: "buyer", stage: "offer", property: redbarn, client: "Riley Demo", clientUser: null, agent: agentId, price: 54_000_000, bps: 250, contract: null, closing: null, lead: leadIds[2] },
      { title: "Silver Street Italianate — listing", side: "seller", stage: "showing", property: ids.get("silver-street-italianate-waterville")!, client: "Demo Seller", clientUser: null, agent: leaderId, price: null, bps: 500, contract: null, closing: null, lead: null },
    ];
    for (const d of deals) {
      const row = await db.one<{ id: string }>(
        `INSERT INTO transactions (team_id, title, side, stage, property_id, lead_id, client_user_id, client_name, agent_id, price_cents, commission_bps, contract_date, closing_date, created_by)
         VALUES ($1, $2, $3::deal_side, $4::deal_stage, $5, $6, $7, $8, $9, $10, $11, $12, $13, $9) RETURNING id`,
        [teamId, d.title, d.side, d.stage, d.property, d.lead, d.clientUser, d.client, d.agent, d.price, d.bps, d.contract, d.closing],
      );
      for (const item of resolveTemplate(DEFAULT_TEMPLATES[d.side].items, { contractDate: d.contract, closingDate: d.closing })) {
        const done = item.dueOn !== null && item.dueOn < day(0) && !item.label.startsWith("Inspection period");
        if (item.milestone) {
          await db.query("INSERT INTO transaction_milestones (transaction_id, label, due_on, sort_order, rule, client_visible, completed_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [row!.id, item.label, item.dueOn, item.sortOrder, item.rule, item.clientVisible, done ? new Date() : null]);
        } else {
          await db.query("INSERT INTO transaction_tasks (transaction_id, title, assignee_id, due_on, status, completed_at) VALUES ($1, $2, $3, $4, $5::task_status, $6)", [row!.id, item.label, d.agent, item.dueOn, done ? "done" : "open", done ? new Date() : null]);
        }
      }
      await db.query("INSERT INTO audit_log (team_id, actor_id, action, entity_type, entity_id, data) VALUES ($1, $2, 'deal.created', 'transaction', $3, '{\"seed\": true}')", [teamId, d.agent, row!.id]);
    }
  });

  // Demo accounts are pre-verified (real sign-ups confirm their email first).
  await withSystemDb((db) => db.query("UPDATE users SET email_verified_at = COALESCE(email_verified_at, now())"));

  // Real government data for the market dashboards (checked-in snapshots, checksum-verified).
  const gov = await importSnapshots();
  console.log(`Imported government datasets: ${Object.entries(gov).map(([k, n]) => `${k} ${n}`).join(", ")}`);

  console.log("\nSeeded Surette Real Estate (demo data).");
  console.log("  Property management: owner@surette.test / surette-owner-2026   ·   agent@surette.test / surette-agent-2026");
  console.log("  Customer:            client@surette.test / surette-client-2026");
  console.log("  Synthetic analytics: run `npm run analytics:demo` with the dev server running.");
  void ownerId;
}

main()
  .then(async () => {
    await getPool().end();
    await closeRedis();
  })
  .catch(async (error) => {
    console.error(error);
    await getPool().end();
    process.exit(1);
  });
