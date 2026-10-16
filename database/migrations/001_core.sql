-- =============================================================================
-- Migration 001 — core schema (PostgreSQL 15+)
--
-- Rules this file enforces at the database level, so no client can break them:
--   * Money is integer cents (BIGINT) everywhere. A $410.67 water bill is 41067.
--     CHECK constraints reject negative prices and zero/negative bills.
--   * Every child row cascades from its parent (deleting a property removes its
--     media, utility bills, showings and collection entries).
--   * Row-Level Security: the web app runs every request inside a transaction as
--     the NOLOGIN role `surette_app`, with the caller's id/role/team in
--     transaction-local settings (app.user_id, app.role, app.team_id). Policies
--     below decide what that caller can read and write.
--   * A confirmed showing can never overlap another confirmed showing for the
--     same property (exclusion constraint).
--   * Changes to listings, media, showings and collections publish a
--     NOTIFY on channel `surette_events`; the web server relays them to browsers
--     and phones over Server-Sent Events, which is how new uploads appear on the
--     public site without a reload.
--
-- Applied by web/scripts/migrate.ts (each migration runs in one transaction and is
-- recorded in schema_migrations). Use `scripts/db.sh reset` to start over in development.
-- =============================================================================


CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- -----------------------------------------------------------------------------
-- Application role used for Row-Level Security
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'surette_app') THEN
    CREATE ROLE surette_app NOLOGIN;
  END IF;
END
$$;

-- The connecting (owner) role must be able to SET ROLE surette_app.
DO $$
BEGIN
  EXECUTE format('GRANT surette_app TO %I', current_user);
END
$$;

-- -----------------------------------------------------------------------------
-- Request context helpers (read the transaction-local settings set by the app)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.role', true), ''), 'anonymous')
$$;

CREATE OR REPLACE FUNCTION app_team_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.team_id', true), '')::uuid
$$;

-- True when the caller is an admin or agent of the given team.
CREATE OR REPLACE FUNCTION app_is_staff_of(team uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_role() IN ('admin', 'agent') AND team IS NOT NULL AND team = app_team_id()
$$;

-- -----------------------------------------------------------------------------
-- Enumerations
-- -----------------------------------------------------------------------------
CREATE TYPE user_role       AS ENUM ('admin', 'agent', 'client');
CREATE TYPE listing_status  AS ENUM ('draft', 'active', 'pending', 'sold', 'off_market');
CREATE TYPE listing_type    AS ENUM ('sale', 'rent');
CREATE TYPE media_kind      AS ENUM ('image', 'video');
CREATE TYPE showing_status  AS ENUM ('requested', 'confirmed', 'completed', 'cancelled');
CREATE TYPE showing_source  AS ENUM ('concierge', 'website', 'agent', 'mobile');
CREATE TYPE utility_kind    AS ENUM ('water', 'electric', 'gas', 'sewer', 'heating_oil', 'internet');
CREATE TYPE item_reaction   AS ENUM ('love', 'maybe', 'pass');

-- -----------------------------------------------------------------------------
-- agent_teams — a brokerage team (Surette Real Estate is one row)
-- -----------------------------------------------------------------------------
CREATE TABLE agent_teams (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,60}$'),
  name          text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  market        text NOT NULL,
  office_phone  text,
  office_email  citext,
  office_address text,
  founded_year  smallint CHECK (founded_year BETWEEN 1800 AND 2100),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- users — staff (admin/agent) and clients. Staff with is_public appear in the
-- public team directory. Clients may be assigned an agent who sees their
-- collections live.
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              citext NOT NULL UNIQUE,
  password_hash      text NOT NULL,
  full_name          text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 120),
  phone              text CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$'),
  role               user_role NOT NULL DEFAULT 'client',
  team_id            uuid REFERENCES agent_teams(id) ON DELETE SET NULL,
  title              text,
  bio                text,
  photo_url          text,
  specialties        text[] NOT NULL DEFAULT '{}',
  is_leader          boolean NOT NULL DEFAULT false,
  is_public          boolean NOT NULL DEFAULT false,
  sort_order         integer NOT NULL DEFAULT 100,
  assigned_agent_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_have_team CHECK (role = 'client' OR team_id IS NOT NULL),
  CONSTRAINT only_staff_public CHECK (NOT is_public OR role IN ('admin', 'agent'))
);
CREATE INDEX users_team_idx ON users (team_id, sort_order) WHERE role IN ('admin', 'agent');
CREATE INDEX users_assigned_agent_idx ON users (assigned_agent_id);
-- At most one leader per team.
CREATE UNIQUE INDEX users_one_leader_per_team ON users (team_id) WHERE is_leader;

-- -----------------------------------------------------------------------------
-- properties — listings shown on the public site
-- -----------------------------------------------------------------------------
CREATE TABLE properties (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id              uuid NOT NULL REFERENCES agent_teams(id) ON DELETE CASCADE,
  listing_agent_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  slug                 text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,120}$'),
  status               listing_status NOT NULL DEFAULT 'draft',
  listing_type         listing_type NOT NULL DEFAULT 'sale',
  title                text NOT NULL CHECK (length(title) BETWEEN 3 AND 140),
  headline             text CHECK (headline IS NULL OR length(headline) <= 200),
  description          text NOT NULL DEFAULT '',
  address_line         text NOT NULL,
  city                 text NOT NULL,
  state                char(2) NOT NULL DEFAULT 'ME',
  postal_code          text NOT NULL CHECK (postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  latitude             numeric(9, 6) CHECK (latitude BETWEEN -90 AND 90),
  longitude            numeric(9, 6) CHECK (longitude BETWEEN -180 AND 180),
  -- Money: integer cents only.
  price_cents          bigint NOT NULL CHECK (price_cents >= 0),
  hoa_monthly_cents    bigint NOT NULL DEFAULT 0 CHECK (hoa_monthly_cents >= 0),
  tax_annual_cents     bigint NOT NULL DEFAULT 0 CHECK (tax_annual_cents >= 0),
  bedrooms             smallint NOT NULL DEFAULT 0 CHECK (bedrooms BETWEEN 0 AND 50),
  full_baths           smallint NOT NULL DEFAULT 0 CHECK (full_baths BETWEEN 0 AND 50),
  half_baths           smallint NOT NULL DEFAULT 0 CHECK (half_baths BETWEEN 0 AND 50),
  living_area_sqft     integer CHECK (living_area_sqft > 0),
  lot_size_sqft        integer CHECK (lot_size_sqft > 0),
  year_built           smallint CHECK (year_built BETWEEN 1600 AND 2100),
  amenities            text[] NOT NULL DEFAULT '{}',
  -- e.g. {"Foundation": "Poured concrete", "Roof": "Standing-seam metal", "Heating": "Radiant floor"}
  structural_features  jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(structural_features) = 'object'),
  school_district      text,
  walk_score           smallint CHECK (walk_score BETWEEN 0 AND 100),
  is_featured          boolean NOT NULL DEFAULT false,
  published_at         timestamptz,
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  search_vector        tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(city, '') || ' ' || coalesce(address_line, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(headline, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) STORED,
  CONSTRAINT coordinates_together CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CONSTRAINT published_needs_timestamp CHECK (status = 'draft' OR published_at IS NOT NULL)
);
CREATE INDEX properties_public_idx ON properties (status, is_featured DESC, published_at DESC);
CREATE INDEX properties_team_idx ON properties (team_id, updated_at DESC);
CREATE INDEX properties_search_idx ON properties USING gin (search_vector);
CREATE INDEX properties_price_idx ON properties (price_cents) WHERE status = 'active';

-- -----------------------------------------------------------------------------
-- media_assets — optimized photos/videos for a property
-- -----------------------------------------------------------------------------
CREATE TABLE media_assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  kind            media_kind NOT NULL DEFAULT 'image',
  -- Public URL of the largest rendition (served by /media/... or a CDN).
  url             text NOT NULL,
  storage_key     text NOT NULL UNIQUE,
  -- {"sm": {"url": "...", "width": 640, "height": 427}, "md": {...}, "xl": {...}}
  variants        jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(variants) = 'object'),
  width           integer NOT NULL CHECK (width > 0),
  height          integer NOT NULL CHECK (height > 0),
  bytes           bigint NOT NULL CHECK (bytes > 0),
  blur_data_url   text,
  alt_text        text NOT NULL DEFAULT '',
  sort_order      integer NOT NULL DEFAULT 0,
  is_cover        boolean NOT NULL DEFAULT false,
  original_name   text,
  uploaded_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_assets_property_idx ON media_assets (property_id, sort_order);
CREATE UNIQUE INDEX media_assets_one_cover ON media_assets (property_id) WHERE is_cover;

-- -----------------------------------------------------------------------------
-- utility_ledgers — water / electric / other bills per property, in cents
-- -----------------------------------------------------------------------------
CREATE TABLE utility_ledgers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id        uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  utility            utility_kind NOT NULL,
  provider           text NOT NULL,
  account_last4      char(4) CHECK (account_last4 ~ '^[0-9]{4}$'),
  period_start       date NOT NULL,
  period_end         date NOT NULL,
  -- Consumption as an integer in the smallest billed unit (gallons, kWh, therms...).
  usage_quantity     integer CHECK (usage_quantity >= 0),
  usage_unit         text CHECK (usage_unit IN ('gallons', 'cubic_feet', 'kwh', 'therms', 'none')),
  amount_cents       bigint NOT NULL CHECK (amount_cents > 0),
  due_on             date,
  paid_on            date,
  notes              text,
  recorded_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT period_order CHECK (period_end >= period_start),
  CONSTRAINT paid_after_start CHECK (paid_on IS NULL OR paid_on >= period_start),
  CONSTRAINT one_bill_per_period UNIQUE (property_id, utility, period_start, period_end)
);
CREATE INDEX utility_ledgers_property_idx ON utility_ledgers (property_id, period_end DESC);

-- -----------------------------------------------------------------------------
-- showings — private showing requests and confirmed appointments
-- -----------------------------------------------------------------------------
CREATE TABLE showings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id      uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  agent_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  client_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  contact_name     text NOT NULL CHECK (length(contact_name) BETWEEN 1 AND 120),
  contact_email    citext NOT NULL,
  contact_phone    text CHECK (contact_phone IS NULL OR contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  status           showing_status NOT NULL DEFAULT 'requested',
  source           showing_source NOT NULL DEFAULT 'website',
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT showing_window CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '3 hours'),
  CONSTRAINT no_double_booking EXCLUDE USING gist (
    property_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status = 'confirmed')
);
CREATE INDEX showings_property_idx ON showings (property_id, starts_at);
CREATE INDEX showings_agent_idx ON showings (agent_id, starts_at);

-- -----------------------------------------------------------------------------
-- Collections (Compass-style saved lists shared with the assigned agent)
-- -----------------------------------------------------------------------------
CREATE TABLE collections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);
CREATE INDEX collections_agent_idx ON collections (agent_id);

CREATE TABLE collection_items (
  collection_id  uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  property_id    uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  reaction       item_reaction,
  note           text CHECK (note IS NULL OR length(note) <= 2000),
  added_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, property_id)
);
CREATE INDEX collection_items_property_idx ON collection_items (property_id);

CREATE TABLE collection_comments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id  uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  property_id    uuid REFERENCES properties(id) ON DELETE CASCADE,
  author_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body           text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collection_comments_idx ON collection_comments (collection_id, created_at);

-- -----------------------------------------------------------------------------
-- Outbound webhooks (notify CRMs, Slack relays, the dispatcher backend, ...)
-- -----------------------------------------------------------------------------
CREATE TABLE webhook_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES agent_teams(id) ON DELETE CASCADE,
  url         text NOT NULL CHECK (url ~ '^https?://'),
  secret      text NOT NULL CHECK (length(secret) >= 32),
  events      text[] NOT NULL DEFAULT '{}',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, url)
);

CREATE TABLE webhook_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id  uuid NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event            text NOT NULL,
  payload          jsonb NOT NULL,
  attempt          smallint NOT NULL DEFAULT 1 CHECK (attempt BETWEEN 1 AND 10),
  status_code      smallint,
  error            text,
  delivered_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_deliveries_sub_idx ON webhook_deliveries (subscription_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent_teams', 'users', 'properties', 'utility_ledgers', 'showings', 'collections', 'collection_items']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t, t);
  END LOOP;
END
$$;

-- Publishing a listing stamps published_at once.
CREATE OR REPLACE FUNCTION stamp_published_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'draft' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER properties_publish BEFORE INSERT OR UPDATE OF status ON properties
  FOR EACH ROW EXECUTE FUNCTION stamp_published_at();

-- Bump the parent collection when its items or comments change (drives "last activity").
CREATE OR REPLACE FUNCTION touch_parent_collection() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE collections SET updated_at = now()
   WHERE id = COALESCE(NEW.collection_id, OLD.collection_id);
  RETURN NULL;
END
$$;
CREATE TRIGGER collection_items_bump AFTER INSERT OR UPDATE OR DELETE ON collection_items
  FOR EACH ROW EXECUTE FUNCTION touch_parent_collection();
CREATE TRIGGER collection_comments_bump AFTER INSERT ON collection_comments
  FOR EACH ROW EXECUTE FUNCTION touch_parent_collection();

-- -----------------------------------------------------------------------------
-- Real-time change feed: NOTIFY surette_events '{...}'
-- Payloads carry only ids and routing hints (never personal data); subscribers
-- re-fetch through the API, where RLS applies.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_surette_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec          record := COALESCE(NEW, OLD);
  payload      jsonb;
  prop_id      uuid;
  coll_id      uuid;
  owner        uuid;
  agent        uuid;
  team         uuid;
  visibility   text := 'staff';
BEGIN
  IF TG_TABLE_NAME = 'properties' THEN
    prop_id := rec.id;
    team := rec.team_id;
    IF rec.status IN ('active', 'pending', 'sold') OR (TG_OP = 'UPDATE' AND OLD.status IN ('active', 'pending', 'sold')) THEN
      visibility := 'public';
    END IF;
  ELSIF TG_TABLE_NAME = 'media_assets' THEN
    prop_id := rec.property_id;
    SELECT p.team_id, CASE WHEN p.status IN ('active', 'pending', 'sold') THEN 'public' ELSE 'staff' END
      INTO team, visibility FROM properties p WHERE p.id = prop_id;
  ELSIF TG_TABLE_NAME = 'showings' THEN
    prop_id := rec.property_id;
    agent := rec.agent_id;
    owner := rec.client_user_id;
    SELECT p.team_id INTO team FROM properties p WHERE p.id = prop_id;
  ELSIF TG_TABLE_NAME = 'collections' THEN
    coll_id := rec.id;
    owner := rec.owner_id;
    agent := rec.agent_id;
    visibility := 'collection';
  ELSE -- collection_items, collection_comments
    coll_id := rec.collection_id;
    prop_id := rec.property_id;
    SELECT c.owner_id, c.agent_id INTO owner, agent FROM collections c WHERE c.id = coll_id;
    visibility := 'collection';
  END IF;

  payload := jsonb_build_object(
    'table', TG_TABLE_NAME,
    'op', lower(TG_OP),
    'visibility', visibility,
    'propertyId', prop_id,
    'collectionId', coll_id,
    'teamId', team,
    'ownerId', owner,
    'agentId', agent,
    'at', floor(extract(epoch FROM clock_timestamp()) * 1000)
  );
  PERFORM pg_notify('surette_events', payload::text);
  RETURN NULL;
END
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['properties', 'media_assets', 'showings', 'collections', 'collection_items', 'collection_comments']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_notify AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION notify_surette_event()', t, t);
  END LOOP;
END
$$;

-- -----------------------------------------------------------------------------
-- Privileges for the application role
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO surette_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  agent_teams, properties, media_assets, utility_ledgers, showings,
  collections, collection_items, collection_comments, webhook_subscriptions, webhook_deliveries
  TO surette_app;
-- users: never expose password_hash to the app role. Auth runs as the owner.
GRANT SELECT (id, email, full_name, phone, role, team_id, title, bio, photo_url, specialties,
              is_leader, is_public, sort_order, assigned_agent_id, created_at, updated_at)
  ON users TO surette_app;
GRANT UPDATE (full_name, phone, title, bio, photo_url, specialties, is_public, sort_order, assigned_agent_id)
  ON users TO surette_app;

-- -----------------------------------------------------------------------------
-- Row-Level Security policies
-- -----------------------------------------------------------------------------
ALTER TABLE agent_teams            ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties             ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE utility_ledgers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE showings               ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections            ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_comments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries     ENABLE ROW LEVEL SECURITY;

-- Teams are public brochure data; only that team's admins edit them.
CREATE POLICY teams_read ON agent_teams FOR SELECT TO surette_app USING (true);
CREATE POLICY teams_admin_write ON agent_teams FOR UPDATE TO surette_app
  USING (app_role() = 'admin' AND id = app_team_id()) WITH CHECK (id = app_team_id());

-- Users: public directory rows, yourself, your assigned agent, and staff see everyone on their team
-- (clients register under the team whose site they signed up on). The helper is SECURITY DEFINER
-- so the policy never recurses into itself.
CREATE OR REPLACE FUNCTION app_my_agent_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT assigned_agent_id FROM users WHERE id = app_user_id()
$$;

CREATE POLICY users_read ON users FOR SELECT TO surette_app USING (
  is_public
  OR id = app_user_id()
  OR id = app_my_agent_id()
  OR app_is_staff_of(team_id)
);
CREATE POLICY users_update_self ON users FOR UPDATE TO surette_app
  USING (id = app_user_id() OR (app_role() = 'admin' AND team_id = app_team_id()))
  WITH CHECK (id = app_user_id() OR (app_role() = 'admin' AND team_id = app_team_id()));

-- Properties: everyone sees published listings; staff see and edit their team's.
CREATE POLICY properties_public_read ON properties FOR SELECT TO surette_app
  USING (status IN ('active', 'pending', 'sold') OR app_is_staff_of(team_id));
CREATE POLICY properties_staff_insert ON properties FOR INSERT TO surette_app
  WITH CHECK (app_is_staff_of(team_id));
CREATE POLICY properties_staff_update ON properties FOR UPDATE TO surette_app
  USING (app_is_staff_of(team_id)) WITH CHECK (app_is_staff_of(team_id));
CREATE POLICY properties_admin_delete ON properties FOR DELETE TO surette_app
  USING (app_role() = 'admin' AND team_id = app_team_id());

-- Media follows its property.
CREATE POLICY media_read ON media_assets FOR SELECT TO surette_app
  USING (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id));
CREATE POLICY media_staff_write ON media_assets FOR ALL TO surette_app
  USING (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id AND app_is_staff_of(p.team_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id AND app_is_staff_of(p.team_id)));

-- Utility ledgers are internal: staff of the owning team only.
CREATE POLICY utilities_staff ON utility_ledgers FOR ALL TO surette_app
  USING (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id AND app_is_staff_of(p.team_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id AND app_is_staff_of(p.team_id)));

-- Showings: anyone may request one for a published listing; requesters see their own; staff manage their team's.
CREATE POLICY showings_request ON showings FOR INSERT TO surette_app WITH CHECK (
  (status = 'requested'
    AND (client_user_id IS NULL OR client_user_id = app_user_id())
    AND EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id AND p.status = 'active'))
  OR EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id AND app_is_staff_of(p.team_id))
);
CREATE POLICY showings_read ON showings FOR SELECT TO surette_app USING (
  client_user_id = app_user_id()
  OR EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id AND app_is_staff_of(p.team_id))
);
CREATE POLICY showings_staff_update ON showings FOR UPDATE TO surette_app
  USING (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id AND app_is_staff_of(p.team_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM properties p WHERE p.id = property_id AND app_is_staff_of(p.team_id)));
CREATE POLICY showings_client_cancel ON showings FOR UPDATE TO surette_app
  USING (client_user_id = app_user_id()) WITH CHECK (client_user_id = app_user_id() AND status = 'cancelled');

-- Collections: the owner and the assigned agent (and the team's admins) share them live.
CREATE OR REPLACE FUNCTION app_can_access_collection(coll uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM collections c
      LEFT JOIN users a ON a.id = c.agent_id
     WHERE c.id = coll
       AND (c.owner_id = app_user_id()
            OR c.agent_id = app_user_id()
            OR (app_role() = 'admin' AND a.team_id = app_team_id()))
  )
$$;

CREATE POLICY collections_access ON collections FOR SELECT TO surette_app
  USING (app_can_access_collection(id));
CREATE POLICY collections_owner_insert ON collections FOR INSERT TO surette_app
  WITH CHECK (owner_id = app_user_id());
CREATE POLICY collections_owner_update ON collections FOR UPDATE TO surette_app
  USING (owner_id = app_user_id()) WITH CHECK (owner_id = app_user_id());
CREATE POLICY collections_owner_delete ON collections FOR DELETE TO surette_app
  USING (owner_id = app_user_id());

CREATE POLICY collection_items_access ON collection_items FOR ALL TO surette_app
  USING (app_can_access_collection(collection_id))
  WITH CHECK (app_can_access_collection(collection_id));

CREATE POLICY collection_comments_read ON collection_comments FOR SELECT TO surette_app
  USING (app_can_access_collection(collection_id));
CREATE POLICY collection_comments_write ON collection_comments FOR INSERT TO surette_app
  WITH CHECK (author_id = app_user_id() AND app_can_access_collection(collection_id));

-- Webhooks: team admins only.
CREATE POLICY webhooks_admin ON webhook_subscriptions FOR ALL TO surette_app
  USING (app_role() = 'admin' AND team_id = app_team_id())
  WITH CHECK (app_role() = 'admin' AND team_id = app_team_id());
CREATE POLICY webhook_deliveries_admin ON webhook_deliveries FOR ALL TO surette_app
  USING (EXISTS (SELECT 1 FROM webhook_subscriptions s WHERE s.id = subscription_id AND s.team_id = app_team_id() AND app_role() = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM webhook_subscriptions s WHERE s.id = subscription_id AND s.team_id = app_team_id() AND app_role() = 'admin'));

-- -----------------------------------------------------------------------------
-- Read model for the public site: one row per published listing with its cover.
-- security_invoker makes the view obey the caller's RLS.
-- -----------------------------------------------------------------------------
CREATE VIEW public_listings WITH (security_invoker = true) AS
SELECT
  p.id, p.slug, p.status, p.listing_type, p.title, p.headline, p.city, p.state, p.postal_code,
  p.address_line, p.latitude, p.longitude, p.price_cents, p.bedrooms, p.full_baths, p.half_baths,
  p.living_area_sqft, p.lot_size_sqft, p.year_built, p.school_district, p.walk_score,
  p.is_featured, p.published_at, p.updated_at,
  cover.url AS cover_url, cover.variants AS cover_variants, cover.blur_data_url AS cover_blur,
  cover.width AS cover_width, cover.height AS cover_height,
  (SELECT count(*) FROM media_assets m WHERE m.property_id = p.id)::int AS media_count
FROM properties p
LEFT JOIN LATERAL (
  SELECT m.url, m.variants, m.blur_data_url, m.width, m.height
    FROM media_assets m
   WHERE m.property_id = p.id AND m.kind = 'image'
   ORDER BY m.is_cover DESC, m.sort_order, m.created_at
   LIMIT 1
) cover ON true
WHERE p.status IN ('active', 'pending', 'sold');

GRANT SELECT ON public_listings TO surette_app;


