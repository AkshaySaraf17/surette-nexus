-- =============================================================================
-- Migration 007 — customer authentication: forgot password, email verification,
-- Sign in with Google.
-- =============================================================================

-- Email verification. Existing accounts (staff, seeded demo customers) count as verified.
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
UPDATE users SET email_verified_at = created_at;

-- Google accounts: the stable Google user id ("sub"). Google-only customers have no password.
ALTER TABLE users ADD COLUMN google_sub text UNIQUE;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_can_sign_in CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL);

-- Bumped on password reset (and change): sessions issued before carry an older version and stop working.
ALTER TABLE users ADD COLUMN session_version integer NOT NULL DEFAULT 1;

-- One-time links. Only a SHA-256 hash of each token is stored, so a database leak can't be
-- used to reset passwords; the raw token exists only in the email.
CREATE TYPE auth_token_purpose AS ENUM ('password_reset', 'email_verify');
CREATE TABLE auth_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     auth_token_purpose NOT NULL,
  token_hash  text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens (user_id, purpose, created_at DESC);
-- No grants to surette_app: tokens are handled only by the auth code (system role).
