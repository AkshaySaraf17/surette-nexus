-- =============================================================================
-- Migration 005 — reliability & scale primitives
--
--   * idempotency_keys     replay-safe POSTs (Idempotency-Key header)
--   * rate_limit_counters  shared fixed-window rate limiting across app instances
--   * outbox_events        transactional outbox: domain events written in the same
--                          transaction as the change, relayed by the worker
--   * jobs                 durable job queue (FOR UPDATE SKIP LOCKED), retries with
--                          backoff, dead-letter state
--   * indexes              for the hot queries found by EXPLAIN (see docs/system-design.md)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Idempotency
-- ---------------------------------------------------------------------------
CREATE TABLE idempotency_keys (
  scope         text NOT NULL,                 -- "user:<id>" or "ip:<addr>"
  key           text NOT NULL CHECK (key ~ '^[A-Za-z0-9_:.-]{8,128}$'),
  method        text NOT NULL,
  path          text NOT NULL,
  request_hash  text NOT NULL,                 -- sha256 of the request body
  status        text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  response_code integer,
  response_body text,
  response_type text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (scope, key)
);
CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys (expires_at);

-- ---------------------------------------------------------------------------
-- Rate limiting (UNLOGGED: fast, and losing counters on a crash is acceptable)
-- ---------------------------------------------------------------------------
CREATE UNLOGGED TABLE rate_limit_counters (
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX rate_limit_counters_window_idx ON rate_limit_counters (window_start);

-- ---------------------------------------------------------------------------
-- Transactional outbox
-- ---------------------------------------------------------------------------
CREATE TABLE outbox_events (
  id            bigserial PRIMARY KEY,
  event_id      uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  team_id       uuid REFERENCES agent_teams(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type ~ '^[a-z_]+\.[a-z_]+$'),
  aggregate     text NOT NULL,                 -- e.g. "lead", "transaction", "property"
  aggregate_id  text,
  payload       jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text
);
CREATE INDEX outbox_unpublished_idx ON outbox_events (id) WHERE published_at IS NULL;
CREATE INDEX outbox_published_idx ON outbox_events (published_at) WHERE published_at IS NOT NULL;

-- Wake the worker immediately instead of waiting for its poll interval.
CREATE FUNCTION notify_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('surette_outbox', NEW.id::text);
  RETURN NULL;
END $$;
CREATE TRIGGER outbox_notify AFTER INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION notify_outbox();

-- ---------------------------------------------------------------------------
-- Job queue
-- ---------------------------------------------------------------------------
CREATE TYPE job_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'dead');

CREATE TABLE jobs (
  id            bigserial PRIMARY KEY,
  queue         text NOT NULL DEFAULT 'default',
  type          text NOT NULL CHECK (type ~ '^[a-z_]+\.[a-z_]+$'),
  payload       jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object'),
  status        job_status NOT NULL DEFAULT 'queued',
  priority      smallint NOT NULL DEFAULT 0,
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 25),
  run_at        timestamptz NOT NULL DEFAULT now(),
  locked_at     timestamptz,
  locked_by     text,
  last_error    text,
  dedupe_key    text,                          -- at most one queued/running job per key
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX jobs_ready_idx ON jobs (queue, priority DESC, run_at, id) WHERE status = 'queued';
CREATE INDEX jobs_running_idx ON jobs (locked_at) WHERE status = 'running';
CREATE INDEX jobs_finished_idx ON jobs (finished_at) WHERE status IN ('succeeded', 'dead');
CREATE UNIQUE INDEX jobs_dedupe_idx ON jobs (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running');

CREATE FUNCTION notify_jobs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('surette_jobs', NEW.queue);
  RETURN NULL;
END $$;
CREATE TRIGGER jobs_notify AFTER INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION notify_jobs();

-- The request role may enqueue events and jobs inside its own transaction, but can't read them.
GRANT INSERT ON outbox_events, jobs TO surette_app;
GRANT USAGE ON SEQUENCE outbox_events_id_seq, jobs_id_seq TO surette_app;

-- ---------------------------------------------------------------------------
-- Indexes for hot paths
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Deadline agenda / dashboard: open milestones and tasks by due date.
CREATE INDEX transaction_milestones_due_idx ON transaction_milestones (due_on) WHERE completed_at IS NULL AND due_on IS NOT NULL;
CREATE INDEX transaction_tasks_due_idx ON transaction_tasks (due_on) WHERE status = 'open' AND due_on IS NOT NULL;
-- Lead duplicate check (same email/phone within 24 h) and follow-ups due.
CREATE INDEX leads_email_idx ON leads (team_id, contact_email, created_at DESC) WHERE contact_email IS NOT NULL;
CREATE INDEX leads_phone_idx ON leads (team_id, contact_phone, created_at DESC) WHERE contact_phone IS NOT NULL;
CREATE INDEX leads_follow_up_idx ON leads (team_id, next_follow_up_on) WHERE next_follow_up_on IS NOT NULL AND status NOT IN ('converted', 'lost');
-- City filter uses lower(city) = lower($1); concierge fuzzy matching uses trigram similarity.
CREATE INDEX properties_city_idx ON properties (lower(city), status);
CREATE INDEX properties_city_trgm_idx ON properties USING gin (city gin_trgm_ops);
-- Showing requests waiting for confirmation.
CREATE INDEX showings_requested_idx ON showings (property_id, created_at DESC) WHERE status = 'requested';
-- Analytics is append-only and time-ordered: BRIN is tiny and fast for range scans at scale.
CREATE INDEX analytics_events_occurred_brin ON analytics_events USING brin (occurred_at);
