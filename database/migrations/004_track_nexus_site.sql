-- =============================================================================
-- Migration 004 — track the Surette Nexus website only.
--
-- Analytics now covers this app's own website (project "nexus-site"). The placeholder
-- project for the separate Lofty site (surette-realestate.com) is removed; it never
-- received events.
-- =============================================================================
DELETE FROM analytics_projects WHERE key = 'surette-live';
UPDATE analytics_projects SET name = 'Surette Nexus website' WHERE key = 'nexus-site';
