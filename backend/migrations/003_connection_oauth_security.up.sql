-- Upgrade legacy plaintext OAuth state storage when present. Fresh installs already
-- create state_hash in migration 001, so this migration is safe for both paths.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='oauth_states' AND column_name='state'
  ) THEN
    -- OAuth state is short-lived; invalidate pending flows before removing plaintext.
    DELETE FROM oauth_states;
    ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_pkey;
    ALTER TABLE oauth_states DROP COLUMN state;
    ALTER TABLE oauth_states ADD COLUMN state_hash TEXT NOT NULL PRIMARY KEY;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='oauth_states' AND column_name='state_hash'
  ) THEN
    RAISE EXCEPTION 'oauth_states must have either state or state_hash; inspect the schema before migrating';
  END IF;
END $$;

DROP INDEX IF EXISTS oauth_states_expiry_idx;
CREATE INDEX oauth_states_expiry_idx ON oauth_states (expires_at) WHERE used_at IS NULL;

-- Keep historical/revoked connections but enforce at most one ACTIVE connection per project.
ALTER TABLE linkedin_connections DROP CONSTRAINT IF EXISTS linkedin_connections_project_id_linkedin_member_id_key;
ALTER TABLE linkedin_connections ALTER COLUMN access_token_encrypted DROP NOT NULL;
DROP INDEX IF EXISTS linkedin_connections_one_active_idx;
CREATE UNIQUE INDEX linkedin_connections_one_active_idx ON linkedin_connections (project_id) WHERE status = 'ACTIVE';
