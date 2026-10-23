-- Rollback cannot recover old OAuth state values: they were deliberately deleted.
DELETE FROM oauth_states;
ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_pkey;
ALTER TABLE oauth_states DROP COLUMN IF EXISTS state_hash;
ALTER TABLE oauth_states ADD COLUMN state TEXT;
UPDATE oauth_states SET state = 'invalidated-' || md5(random()::text || clock_timestamp()::text);
ALTER TABLE oauth_states ALTER COLUMN state SET NOT NULL;
ALTER TABLE oauth_states ADD PRIMARY KEY (state);
DROP INDEX IF EXISTS oauth_states_expiry_idx;
CREATE INDEX oauth_states_expiry_idx ON oauth_states (expires_at) WHERE used_at IS NULL;

-- Deliberately do not restore the old member uniqueness constraint or NOT NULL token:
-- reconnect history may contain multiple revoked rows and revoked tokens may be wiped.
DROP INDEX IF EXISTS linkedin_connections_one_active_idx;
CREATE UNIQUE INDEX linkedin_connections_one_active_idx ON linkedin_connections (project_id) WHERE status = 'ACTIVE';
