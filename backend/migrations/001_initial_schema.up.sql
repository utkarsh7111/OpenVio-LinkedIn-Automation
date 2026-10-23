-- OpenVio LinkedIn module schema.
-- Shared OpenVio tables (projects, dev_users, project_members) are owned by the host app
-- and must exist before this migration. Fail safely if their expected contract differs.
DO $$
DECLARE
  missing_columns TEXT;
BEGIN
  IF to_regclass('public.projects') IS NULL
     OR to_regclass('public.dev_users') IS NULL
     OR to_regclass('public.project_members') IS NULL THEN
    RAISE EXCEPTION 'OpenVio shared tables projects, dev_users, and project_members must exist before LinkedIn migrations';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='projects' AND column_name='id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='dev_users' AND column_name='id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='project_members' AND column_name='project_id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='project_members' AND column_name='user_id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='project_members' AND column_name='linkedin_module_access' AND data_type='boolean'
  ) THEN
    RAISE EXCEPTION 'OpenVio shared schema mismatch: expected UUID IDs and project_members.linkedin_module_access BOOLEAN. Do not run module migrations until the host schema is mapped.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE linkedin_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES dev_users(id) ON DELETE SET NULL,
  linkedin_member_id TEXT NOT NULL,
  author_urn TEXT NOT NULL,
  display_name TEXT,
  profile_picture_url TEXT,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  access_token_expires_at TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED', 'REAUTH_REQUIRED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT linkedin_connections_token_required_when_active CHECK (status <> 'ACTIVE' OR access_token_encrypted IS NOT NULL)
);
CREATE UNIQUE INDEX linkedin_connections_one_active_idx ON linkedin_connections (project_id) WHERE status = 'ACTIVE';
CREATE INDEX linkedin_connections_project_idx ON linkedin_connections (project_id);
CREATE TRIGGER linkedin_connections_updated_at BEFORE UPDATE ON linkedin_connections FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES dev_users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX oauth_states_expiry_idx ON oauth_states (expires_at) WHERE used_at IS NULL;

CREATE TABLE linkedin_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES linkedin_connections(id) ON DELETE SET NULL,
  created_by_user_id UUID REFERENCES dev_users(id) ON DELETE SET NULL,
  content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 3000),
  media JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(media) = 'array' AND jsonb_array_length(media) <= 20),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED')),
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  linkedin_post_urn TEXT,
  error_code TEXT CHECK (length(error_code) <= 100),
  error_message TEXT CHECK (length(error_message) <= 1000),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 100),
  publishing_started_at TIMESTAMPTZ,
  ai_generated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CHECK (status <> 'SCHEDULED' OR scheduled_at IS NOT NULL),
  CHECK (status <> 'PUBLISHED' OR linkedin_post_urn IS NOT NULL)
);
CREATE UNIQUE INDEX linkedin_posts_urn_unique_idx ON linkedin_posts (linkedin_post_urn) WHERE linkedin_post_urn IS NOT NULL;
CREATE INDEX linkedin_posts_stuck_idx ON linkedin_posts (publishing_started_at) WHERE status = 'PUBLISHING';
CREATE TRIGGER linkedin_posts_updated_at BEFORE UPDATE ON linkedin_posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX linkedin_posts_project_created_idx ON linkedin_posts (project_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX linkedin_posts_due_idx ON linkedin_posts (scheduled_at, id) WHERE status = 'SCHEDULED' AND deleted_at IS NULL;

CREATE TABLE notifications_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES linkedin_posts(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (length(type) <= 100),
  message TEXT NOT NULL CHECK (length(message) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_log_post_idx ON notifications_log (post_id, created_at DESC);
