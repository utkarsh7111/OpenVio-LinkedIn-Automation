CREATE TABLE linkedin_post_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES linkedin_posts(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  actor_user_id UUID REFERENCES dev_users(id) ON DELETE SET NULL,
  detail TEXT CHECK (length(detail) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX linkedin_post_events_post_created_idx ON linkedin_post_events (post_id, created_at);
ALTER TABLE linkedin_posts ADD COLUMN idempotency_key TEXT;
ALTER TABLE linkedin_posts ADD COLUMN last_error_at TIMESTAMPTZ;
CREATE UNIQUE INDEX linkedin_posts_project_idempotency_unique_idx
  ON linkedin_posts (project_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX linkedin_posts_project_status_created_idx
  ON linkedin_posts (project_id, status, created_at DESC) WHERE deleted_at IS NULL;
