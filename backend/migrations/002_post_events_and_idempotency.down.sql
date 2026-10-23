-- Reverses migration 002 only; events and idempotency keys are discarded.
DROP INDEX IF EXISTS linkedin_posts_project_status_created_idx;
DROP INDEX IF EXISTS linkedin_posts_project_idempotency_unique_idx;
ALTER TABLE linkedin_posts DROP COLUMN IF EXISTS last_error_at;
ALTER TABLE linkedin_posts DROP COLUMN IF EXISTS idempotency_key;
DROP INDEX IF EXISTS linkedin_post_events_post_created_idx;
DROP TABLE IF EXISTS linkedin_post_events;
