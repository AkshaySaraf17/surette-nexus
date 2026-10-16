-- Drops every Surette Nexus object so schema.sql can be applied again (development only).
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;
