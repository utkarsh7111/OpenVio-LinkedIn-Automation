-- Drop only tables owned by this LinkedIn module. Never drop OpenVio shared tables.
DROP TABLE IF EXISTS notifications_log;
DROP TABLE IF EXISTS linkedin_posts;
DROP TABLE IF EXISTS oauth_states;
DROP TABLE IF EXISTS linkedin_connections;
-- set_updated_at() may be shared by the host application; intentionally retain it.
