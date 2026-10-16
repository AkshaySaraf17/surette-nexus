-- =============================================================================
-- Migration 002 — operations & intelligence platform
--
-- Adds: account security fields, richer property attributes + provenance,
-- leads and consent records, saved searches / history / comparisons,
-- Dual-Move scenarios, transactions (deals) with milestones, tasks, documents,
-- communication drafts and task templates, a generic append-only audit log,
-- first-party analytics (projects + events), market data (series +
-- observations + fetch log), and AI-generated summaries.
--
-- Separation of data classes:
--   public property info  -> properties / media_assets (public read when published)
--   anonymous analytics   -> analytics_events (owners only, never joined to people)
--   lead records          -> leads / consent_records (staff of the team)
--   confidential deals    -> transactions + children (assigned agent / admins;
--                            the client sees only stage + milestones)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Accounts
-- -----------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN failed_logins smallint NOT NULL DEFAULT 0,
  ADD COLUMN locked_until timestamptz,
  ADD COLUMN last_login_at timestamptz;

-- -----------------------------------------------------------------------------
-- Properties: searchable attributes and provenance
-- -----------------------------------------------------------------------------
CREATE TYPE property_type AS ENUM ('single_family', 'condo', 'multi_family', 'land', 'commercial', 'apartment');

ALTER TABLE properties
  ADD COLUMN property_type property_type NOT NULL DEFAULT 'single_family',
  ADD COLUMN garage_spaces smallint NOT NULL DEFAULT 0 CHECK (garage_spaces BETWEEN 0 AND 20),
  -- Where the record came from: 'portal' (entered by the team), 'csv_import', 'demo' (synthetic seed).
  ADD COLUMN source text NOT NULL DEFAULT 'portal' CHECK (source IN ('portal', 'csv_import', 'mls_feed', 'demo')),
  ADD COLUMN source_ref text,
  ADD COLUMN status_verified_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX properties_source_ref_idx ON properties (team_id, source, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX properties_filter_idx ON properties (status, property_type, bedrooms, price_cents);

-- Re-create the public read model with the new columns.
DROP VIEW public_listings;
CREATE VIEW public_listings WITH (security_invoker = true) AS
SELECT p.id, p.slug, p.status, p.listing_type, p.property_type, p.title, p.headline, p.city, p.state, p.postal_code,
       p.address_line, p.latitude, p.longitude, p.price_cents, p.bedrooms, p.full_baths, p.half_baths,
       p.garage_spaces, p.living_area_sqft, p.lot_size_sqft, p.year_built, p.school_district, p.walk_score,
       p.is_featured, p.published_at, p.updated_at, p.source, p.status_verified_at
  FROM properties p
 WHERE p.status IN ('active', 'pending', 'sold');
GRANT SELECT ON public_listings TO surette_app;

-- Touch status_verified_at whenever an agent changes or re-confirms status.
CREATE OR REPLACE FUNCTION stamp_status_verified() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_verified_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER properties_status_verified BEFORE INSERT OR UPDATE OF status ON properties
  FOR EACH ROW EXECUTE FUNCTION stamp_status_verified();

-- -----------------------------------------------------------------------------
-- Generic append-only audit log (administrative and deal actions)
-- -----------------------------------------------------------------------------
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  team_id     uuid REFERENCES agent_teams(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_log_team_idx ON audit_log (team_id, created_at DESC);

CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Allow cascades from deleting a whole team; block every other change.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM agent_teams WHERE id = OLD.team_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only';
END
$$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- -----------------------------------------------------------------------------
-- Leads and consent
-- -----------------------------------------------------------------------------
CREATE TYPE lead_source AS ENUM ('concierge', 'contact_form', 'showing_request', 'dual_move', 'signup', 'manual', 'import');
CREATE TYPE lead_status AS ENUM ('new', 'contacted', 'qualified', 'nurturing', 'converted', 'lost');

CREATE TABLE leads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id            uuid NOT NULL REFERENCES agent_teams(id) ON DELETE CASCADE,
  source             lead_source NOT NULL,
  status             lead_status NOT NULL DEFAULT 'new',
  contact_name       text NOT NULL CHECK (length(contact_name) BETWEEN 1 AND 120),
  contact_email      citext,
  contact_phone      text CHECK (contact_phone IS NULL OR contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  message            text CHECK (message IS NULL OR length(message) <= 4000),
  -- Explicitly provided preferences only (budget, beds, towns, features...). Never inferred attributes.
  preferences        jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(preferences) = 'object'),
  summary            text,
  property_id        uuid REFERENCES properties(id) ON DELETE SET NULL,
  assigned_agent_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  client_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  consent_contact    boolean NOT NULL,
  consent_text       text NOT NULL,
  next_follow_up_on  date,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_contactable CHECK (contact_email IS NOT NULL OR contact_phone IS NOT NULL),
  CONSTRAINT lead_requires_consent CHECK (consent_contact)
);
CREATE INDEX leads_team_idx ON leads (team_id, status, created_at DESC);
CREATE INDEX leads_agent_idx ON leads (assigned_agent_id, status);
CREATE TRIGGER leads_touch BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE lead_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  author_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  body       text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_notes_idx ON lead_notes (lead_id, created_at);

CREATE TYPE consent_purpose AS ENUM ('analytics', 'contact', 'marketing', 'data_storage');

CREATE TABLE consent_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid NOT NULL REFERENCES agent_teams(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  lead_id      uuid REFERENCES leads(id) ON DELETE CASCADE,
  purpose      consent_purpose NOT NULL,
  granted      boolean NOT NULL,
  text_version text NOT NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consent_subject CHECK (user_id IS NOT NULL OR lead_id IS NOT NULL)
);
CREATE INDEX consent_records_user_idx ON consent_records (user_id, purpose, recorded_at DESC);

-- -----------------------------------------------------------------------------
-- Customer workspace: saved searches, history, comparisons, Dual-Move scenarios
-- -----------------------------------------------------------------------------
CREATE TABLE saved_searches (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  criteria   jsonb NOT NULL CHECK (jsonb_typeof(criteria) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE search_history (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  criteria     jsonb NOT NULL,
  result_count integer NOT NULL CHECK (result_count >= 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX search_history_user_idx ON search_history (user_id, created_at DESC);

CREATE TABLE property_comparisons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL DEFAULT 'Comparison',
  property_ids uuid[] NOT NULL CHECK (cardinality(property_ids) BETWEEN 2 AND 4),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dual_move_scenarios (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  inputs     jsonb NOT NULL CHECK (jsonb_typeof(inputs) = 'object'),
  results    jsonb NOT NULL CHECK (jsonb_typeof(results) = 'object'),
  shared_with_agent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dual_move_user_idx ON dual_move_scenarios (user_id, updated_at DESC);
CREATE TRIGGER dual_move_touch BEFORE UPDATE ON dual_move_scenarios FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- -----------------------------------------------------------------------------
-- Transactions (deals)
-- -----------------------------------------------------------------------------
CREATE TYPE deal_side  AS ENUM ('buyer', 'seller', 'dual', 'lease');
CREATE TYPE deal_stage AS ENUM ('prospect', 'showing', 'offer', 'under_contract', 'inspection', 'appraisal', 'clear_to_close', 'closed', 'lost');

CREATE TABLE transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id          uuid NOT NULL REFERENCES agent_teams(id) ON DELETE CASCADE,
  title            text NOT NULL CHECK (length(title) BETWEEN 2 AND 140),
  side             deal_side NOT NULL,
  stage            deal_stage NOT NULL DEFAULT 'prospect',
  property_id      uuid REFERENCES properties(id) ON DELETE SET NULL,
  lead_id          uuid REFERENCES leads(id) ON DELETE SET NULL,
  client_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  client_name      text NOT NULL CHECK (length(client_name) BETWEEN 1 AND 120),
  client_email     citext,
  agent_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Money: integer cents; commission in basis points (250 = 2.50%).
  price_cents      bigint CHECK (price_cents IS NULL OR price_cents >= 0),
  commission_bps   integer CHECK (commission_bps IS NULL OR commission_bps BETWEEN 0 AND 1500),
  contract_date    date,
  closing_date     date,
  lost_reason      text,
  notes            text,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT closing_after_contract CHECK (closing_date IS NULL OR contract_date IS NULL OR closing_date >= contract_date),
  CONSTRAINT lost_has_reason CHECK (stage <> 'lost' OR lost_reason IS NOT NULL)
);
CREATE INDEX transactions_team_idx ON transactions (team_id, stage, updated_at DESC);
CREATE INDEX transactions_agent_idx ON transactions (agent_id, stage);
CREATE INDEX transactions_client_idx ON transactions (client_user_id);
CREATE TRIGGER transactions_touch BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE transaction_milestones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  label          text NOT NULL CHECK (length(label) BETWEEN 1 AND 140),
  due_on         date,
  completed_at   timestamptz,
  sort_order     integer NOT NULL DEFAULT 0,
  -- How due_on was set: by a template rule relative to a key date, or manually.
  rule           text,
  client_visible boolean NOT NULL DEFAULT true
);
CREATE INDEX transaction_milestones_idx ON transaction_milestones (transaction_id, sort_order);

CREATE TYPE task_status AS ENUM ('open', 'done', 'skipped');

CREATE TABLE transaction_tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  milestone_id   uuid REFERENCES transaction_milestones(id) ON DELETE SET NULL,
  title          text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  assignee_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  due_on         date,
  status         task_status NOT NULL DEFAULT 'open',
  completed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX transaction_tasks_idx ON transaction_tasks (transaction_id, status, due_on);
CREATE INDEX transaction_tasks_assignee_idx ON transaction_tasks (assignee_id, status, due_on);

CREATE TYPE extraction_status AS ENUM ('not_extracted', 'needs_review', 'verified', 'rejected');

CREATE TABLE transaction_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id    uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  label             text NOT NULL CHECK (length(label) BETWEEN 1 AND 140),
  file_name         text NOT NULL,
  mime_type         text NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'text/plain')),
  bytes             bigint NOT NULL CHECK (bytes > 0 AND bytes <= 26214400),
  sha256            text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  storage_key       text NOT NULL UNIQUE,
  -- Candidate values found by text extraction: [{"field","value","source":"page 1: ..."}]
  extracted         jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(extracted) = 'array'),
  extraction_status extraction_status NOT NULL DEFAULT 'not_extracted',
  verified_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  verified_at       timestamptz,
  uploaded_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX transaction_documents_idx ON transaction_documents (transaction_id, created_at DESC);

CREATE TYPE draft_status AS ENUM ('draft', 'approved', 'sent_manually', 'discarded');

CREATE TABLE communication_drafts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id        uuid NOT NULL REFERENCES agent_teams(id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES transactions(id) ON DELETE CASCADE,
  lead_id        uuid REFERENCES leads(id) ON DELETE CASCADE,
  to_email       citext,
  subject        text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  body           text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  status         draft_status NOT NULL DEFAULT 'draft',
  ai_generated   boolean NOT NULL DEFAULT false,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at    timestamptz,
  sent_marked_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- A draft can only be marked sent after a human approved it.
  CONSTRAINT sent_requires_approval CHECK (status <> 'sent_manually' OR approved_at IS NOT NULL)
);
CREATE INDEX communication_drafts_idx ON communication_drafts (team_id, status, created_at DESC);
CREATE TRIGGER communication_drafts_touch BEFORE UPDATE ON communication_drafts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Configurable checklists: items are offsets from a key date (contract or closing).
CREATE TABLE task_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid NOT NULL REFERENCES agent_teams(id) ON DELETE CASCADE,
  name       text NOT NULL,
  side       deal_side NOT NULL,
  -- [{"label":"Inspection deadline","anchor":"contract","offset_days":10,"milestone":true,"client_visible":true}]
  items      jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, name)
);

-- -----------------------------------------------------------------------------
-- First-party analytics
-- -----------------------------------------------------------------------------
CREATE TYPE data_class AS ENUM ('production', 'synthetic', 'test');

CREATE TABLE analytics_projects (
  key             text PRIMARY KEY CHECK (key ~ '^[a-z0-9-]{3,40}$'),
  team_id         uuid NOT NULL REFERENCES agent_teams(id) ON DELETE CASCADE,
  name            text NOT NULL,
  data_class      data_class NOT NULL,
  allowed_origins text[] NOT NULL DEFAULT '{}',
  retention_days  integer NOT NULL DEFAULT 395 CHECK (retention_days BETWEEN 7 AND 1825),
  -- Event categories this project accepts (subset of the server allow-list).
  enabled_categories text[] NOT NULL DEFAULT ARRAY['navigation', 'engagement', 'discovery', 'conversion'],
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE analytics_events (
  event_id        uuid PRIMARY KEY,               -- generated by the SDK; duplicates are ignored
  project_key     text NOT NULL REFERENCES analytics_projects(key) ON DELETE CASCADE,
  data_class      data_class NOT NULL,            -- copied from the project, never from the client
  type            text NOT NULL CHECK (type ~ '^[a-z_]{3,40}$'),
  category        text NOT NULL,
  occurred_at     timestamptz NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  session_id      text NOT NULL CHECK (session_id ~ '^[A-Za-z0-9_-]{8,40}$'),
  visitor_id      text CHECK (visitor_id IS NULL OR visitor_id ~ '^[A-Za-z0-9_-]{8,40}$'),
  path            text NOT NULL CHECK (length(path) <= 300),
  referrer_domain text CHECK (referrer_domain IS NULL OR length(referrer_domain) <= 120),
  utm_source      text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  device          text CHECK (device IN ('desktop', 'mobile', 'tablet', 'other')),
  property_id     uuid,                          -- not an FK: events outlive listings
  props           jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(props) = 'object')
);
CREATE INDEX analytics_events_time_idx ON analytics_events (project_key, data_class, occurred_at);
CREATE INDEX analytics_events_session_idx ON analytics_events (session_id, occurred_at);
CREATE INDEX analytics_events_type_idx ON analytics_events (project_key, type, occurred_at);
CREATE INDEX analytics_events_property_idx ON analytics_events (property_id, occurred_at) WHERE property_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Market data (public sources only; every value keeps its provenance)
-- -----------------------------------------------------------------------------
CREATE TABLE market_series (
  id          text PRIMARY KEY,                   -- e.g. 'fred:MORTGAGE30US'
  source      text NOT NULL,                      -- 'FRED' | 'US Census ACS'
  source_series_id text NOT NULL,
  title       text NOT NULL,
  units       text NOT NULL,
  geography   text NOT NULL,
  geo_level   text NOT NULL CHECK (geo_level IN ('national', 'state', 'county')),
  frequency   text NOT NULL,
  source_url  text NOT NULL,
  original_source text NOT NULL,                  -- e.g. 'Freddie Mac' via FRED
  notes       text,
  last_fetched_at timestamptz,
  last_error  text
);

CREATE TABLE market_observations (
  series_id    text NOT NULL REFERENCES market_series(id) ON DELETE CASCADE,
  period       date NOT NULL,
  value        numeric NOT NULL,
  retrieved_at timestamptz NOT NULL,
  PRIMARY KEY (series_id, period)
);

-- -----------------------------------------------------------------------------
-- AI-generated text, always stored separately from trusted data
-- -----------------------------------------------------------------------------
CREATE TABLE ai_summaries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid REFERENCES agent_teams(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id   text NOT NULL,
  kind        text NOT NULL,
  content     text NOT NULL,
  engine      text NOT NULL,                      -- 'ollama:<model>' or 'rules'
  sources     jsonb NOT NULL DEFAULT '[]',
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_summaries_entity_idx ON ai_summaries (entity_type, entity_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- Live change feed for the new operational tables
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_ops_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec   record := COALESCE(NEW, OLD);
  team  uuid;
  owner uuid;
  agent uuid;
  deal  uuid;
BEGIN
  IF TG_TABLE_NAME = 'leads' THEN
    team := rec.team_id; agent := rec.assigned_agent_id;
  ELSIF TG_TABLE_NAME = 'transactions' THEN
    team := rec.team_id; agent := rec.agent_id; owner := rec.client_user_id; deal := rec.id;
  ELSE
    deal := rec.transaction_id;
    SELECT t.team_id, t.agent_id, t.client_user_id INTO team, agent, owner FROM transactions t WHERE t.id = deal;
  END IF;
  PERFORM pg_notify('surette_events', jsonb_build_object(
    'table', TG_TABLE_NAME, 'op', lower(TG_OP), 'visibility', 'staff',
    'propertyId', NULL, 'collectionId', NULL, 'transactionId', deal,
    'teamId', team, 'ownerId', owner, 'agentId', agent,
    'at', floor(extract(epoch FROM clock_timestamp()) * 1000))::text);
  RETURN NULL;
END
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leads', 'transactions', 'transaction_milestones', 'transaction_tasks', 'transaction_documents']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_notify AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION notify_ops_event()', t, t);
  END LOOP;
END
$$;

-- -----------------------------------------------------------------------------
-- Privileges and Row-Level Security
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  leads, lead_notes, consent_records, saved_searches, property_comparisons, dual_move_scenarios,
  transactions, transaction_milestones, transaction_tasks, transaction_documents, communication_drafts,
  task_templates, ai_summaries
  TO surette_app;
GRANT SELECT, INSERT, DELETE ON search_history TO surette_app;
GRANT USAGE ON SEQUENCE search_history_id_seq TO surette_app;
GRANT SELECT, INSERT ON audit_log TO surette_app;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO surette_app;
GRANT SELECT ON analytics_projects, analytics_events TO surette_app;
GRANT SELECT ON market_series, market_observations TO surette_app;
GRANT UPDATE (is_active) ON users TO surette_app;
GRANT SELECT (is_active, last_login_at) ON users TO surette_app;

ALTER TABLE audit_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_notes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records       ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_searches        ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_history        ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_comparisons  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dual_move_scenarios   ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_tasks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_drafts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_templates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_projects    ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_series         ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_observations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_summaries          ENABLE ROW LEVEL SECURITY;

-- Audit: staff of the team read; any authenticated caller may append for its own team.
CREATE POLICY audit_read ON audit_log FOR SELECT TO surette_app USING (app_role() = 'admin' AND team_id = app_team_id());
CREATE POLICY audit_append ON audit_log FOR INSERT TO surette_app WITH CHECK (actor_id = app_user_id());

-- Leads: admins see the team's; agents see leads assigned to them and unassigned ones (to claim).
CREATE POLICY leads_staff_read ON leads FOR SELECT TO surette_app USING (
  app_is_staff_of(team_id) AND (app_role() = 'admin' OR assigned_agent_id = app_user_id() OR assigned_agent_id IS NULL)
);
CREATE POLICY leads_staff_write ON leads FOR UPDATE TO surette_app
  USING (app_is_staff_of(team_id) AND (app_role() = 'admin' OR assigned_agent_id = app_user_id() OR assigned_agent_id IS NULL))
  WITH CHECK (app_is_staff_of(team_id) AND (app_role() = 'admin' OR assigned_agent_id = app_user_id()));
CREATE POLICY leads_staff_insert ON leads FOR INSERT TO surette_app WITH CHECK (app_is_staff_of(team_id));
CREATE POLICY leads_admin_delete ON leads FOR DELETE TO surette_app USING (app_role() = 'admin' AND team_id = app_team_id());

CREATE POLICY lead_notes_access ON lead_notes FOR ALL TO surette_app
  USING (EXISTS (SELECT 1 FROM leads l WHERE l.id = lead_id))
  WITH CHECK (author_id = app_user_id() AND EXISTS (SELECT 1 FROM leads l WHERE l.id = lead_id));

-- Consent: the person themselves, and staff of the team.
CREATE POLICY consent_read ON consent_records FOR SELECT TO surette_app
  USING (user_id = app_user_id() OR app_is_staff_of(team_id));
CREATE POLICY consent_self_insert ON consent_records FOR INSERT TO surette_app
  WITH CHECK (user_id = app_user_id());

-- Customer workspace rows belong to exactly one user.
CREATE POLICY saved_searches_owner ON saved_searches FOR ALL TO surette_app USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
CREATE POLICY search_history_owner ON search_history FOR ALL TO surette_app USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
CREATE POLICY comparisons_owner ON property_comparisons FOR ALL TO surette_app USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
CREATE POLICY scenarios_owner ON dual_move_scenarios FOR ALL TO surette_app USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
-- Agents may read scenarios a client explicitly shared, if they are that client's assigned agent.
CREATE POLICY scenarios_shared ON dual_move_scenarios FOR SELECT TO surette_app USING (
  shared_with_agent AND EXISTS (SELECT 1 FROM users u WHERE u.id = user_id AND u.assigned_agent_id = app_user_id())
);

-- Transactions: admins see the team's, agents their own deals, clients their own deal (read-only).
CREATE OR REPLACE FUNCTION app_can_staff_deal(deal uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM transactions t
     WHERE t.id = deal AND app_is_staff_of(t.team_id)
       AND (app_role() = 'admin' OR t.agent_id = app_user_id())
  )
$$;
CREATE OR REPLACE FUNCTION app_is_deal_client(deal uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM transactions t WHERE t.id = deal AND t.client_user_id = app_user_id())
$$;

CREATE POLICY deals_read ON transactions FOR SELECT TO surette_app
  USING (app_can_staff_deal(id) OR client_user_id = app_user_id());
CREATE POLICY deals_insert ON transactions FOR INSERT TO surette_app
  WITH CHECK (app_is_staff_of(team_id) AND (app_role() = 'admin' OR agent_id = app_user_id()));
CREATE POLICY deals_update ON transactions FOR UPDATE TO surette_app
  USING (app_can_staff_deal(id))
  WITH CHECK (app_is_staff_of(team_id) AND (app_role() = 'admin' OR agent_id = app_user_id()));
CREATE POLICY deals_delete ON transactions FOR DELETE TO surette_app USING (app_role() = 'admin' AND team_id = app_team_id());

CREATE POLICY milestones_staff ON transaction_milestones FOR ALL TO surette_app
  USING (app_can_staff_deal(transaction_id)) WITH CHECK (app_can_staff_deal(transaction_id));
CREATE POLICY milestones_client_read ON transaction_milestones FOR SELECT TO surette_app
  USING (client_visible AND app_is_deal_client(transaction_id));
CREATE POLICY tasks_staff ON transaction_tasks FOR ALL TO surette_app
  USING (app_can_staff_deal(transaction_id)) WITH CHECK (app_can_staff_deal(transaction_id));
CREATE POLICY documents_staff ON transaction_documents FOR ALL TO surette_app
  USING (app_can_staff_deal(transaction_id)) WITH CHECK (app_can_staff_deal(transaction_id));

CREATE POLICY drafts_staff ON communication_drafts FOR ALL TO surette_app
  USING (app_is_staff_of(team_id) AND (transaction_id IS NULL OR app_can_staff_deal(transaction_id)))
  WITH CHECK (app_is_staff_of(team_id) AND (transaction_id IS NULL OR app_can_staff_deal(transaction_id)));

CREATE POLICY templates_read ON task_templates FOR SELECT TO surette_app USING (app_is_staff_of(team_id));
CREATE POLICY templates_admin ON task_templates FOR ALL TO surette_app
  USING (app_role() = 'admin' AND team_id = app_team_id()) WITH CHECK (app_role() = 'admin' AND team_id = app_team_id());

-- Analytics: company-level data is for the team's owners/admins only.
CREATE POLICY analytics_projects_admin ON analytics_projects FOR SELECT TO surette_app
  USING (app_role() = 'admin' AND team_id = app_team_id());
CREATE POLICY analytics_events_admin ON analytics_events FOR SELECT TO surette_app
  USING (EXISTS (SELECT 1 FROM analytics_projects p WHERE p.key = project_key AND p.team_id = app_team_id() AND app_role() = 'admin'));

-- Market data is public.
CREATE POLICY market_series_read ON market_series FOR SELECT TO surette_app USING (true);
CREATE POLICY market_observations_read ON market_observations FOR SELECT TO surette_app USING (true);

CREATE POLICY ai_summaries_staff ON ai_summaries FOR ALL TO surette_app
  USING (app_is_staff_of(team_id)) WITH CHECK (app_is_staff_of(team_id));
