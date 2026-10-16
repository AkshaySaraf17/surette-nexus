-- =============================================================================
-- Migration 006 — government datasets for the market dashboards
--
--   * towns as a geography level (Census county subdivisions: Waterville, Oakland, …)
--   * margin of error per observation (ACS estimates are published with one)
--   * dataset provenance: which agency file each import came from, when, and its checksum
--   * retire the old key-only ACS API series (replaced by keyless bulk files)
-- =============================================================================
ALTER TABLE market_series DROP CONSTRAINT market_series_geo_level_check;
ALTER TABLE market_series ADD CONSTRAINT market_series_geo_level_check CHECK (geo_level IN ('national', 'state', 'county', 'town'));
ALTER TABLE market_series ADD COLUMN dataset text;

ALTER TABLE market_observations ADD COLUMN moe numeric CHECK (moe IS NULL OR moe >= 0);

CREATE TABLE gov_dataset_imports (
  id           bigserial PRIMARY KEY,
  dataset      text NOT NULL,
  agency       text NOT NULL,
  title        text NOT NULL,
  source_files jsonb NOT NULL,          -- [{url, bytes, sha256}]
  retrieved_at timestamptz NOT NULL,
  imported_at  timestamptz NOT NULL DEFAULT now(),
  observations integer NOT NULL,
  via          text NOT NULL CHECK (via IN ('snapshot', 'live'))
);
CREATE INDEX gov_dataset_imports_idx ON gov_dataset_imports (dataset, imported_at DESC);
GRANT SELECT ON gov_dataset_imports TO surette_app;

DELETE FROM market_series WHERE id LIKE 'acs:B%';
