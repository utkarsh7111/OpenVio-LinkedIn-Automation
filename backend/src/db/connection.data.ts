import type pg from 'pg';
import { pool } from './pool.js';

export interface OAuthStateCreateParams {
  stateHash: string;
  userId: string;
  projectId: string;
  expiresAt: string;
}

export interface OAuthStateConsumeResult {
  status: 'consumed' | 'expired' | 'invalid';
  user_id?: string;
  project_id?: string;
}

export interface LinkedInConnectionRecord {
  id: string;
  project_id: string;
  linkedin_member_id: string;
  author_urn: string;
  display_name: string | null;
  profile_picture_url: string | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  scopes: string[];
  status: string;
  created_at: string;
  updated_at: string;
  access_token_encrypted?: string | null;
}

export interface ConnectParams {
  projectId: string;
  userId: string;
  memberId: string;
  authorUrn: string;
  displayName: string | null;
  pictureUrl: string | null;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  expiresAt: string;
  refreshExpiresAt: string | null;
  scopes: string[];
}

export interface ConnectionData {
  deleteExpiredOAuthStates(): Promise<void>;
  createOAuthState(params: OAuthStateCreateParams): Promise<void>;
  consumeOAuthState(stateHash: string): Promise<OAuthStateConsumeResult>;
  getConnection(projectId: string): Promise<LinkedInConnectionRecord | null>;
  getActiveConnectionForDisconnect(projectId: string): Promise<{ id: string; access_token_encrypted: string; linkedin_member_id: string; status: string } | null>;
  setExpired(connectionId: string): Promise<void>;
  isAllowed(projectId: string, userId: string): Promise<boolean>;
  disconnect(projectId: string): Promise<void>;
  connect(params: ConnectParams): Promise<{ id: string; replacedCount: number }>;
}

export function createConnectionData(database: any = pool): ConnectionData {
  return Object.freeze({
    async deleteExpiredOAuthStates(): Promise<void> {
      await database.query('DELETE FROM oauth_states WHERE expires_at <= now()');
    },
    async createOAuthState({ stateHash, userId, projectId, expiresAt }: OAuthStateCreateParams): Promise<void> {
      await database.query('INSERT INTO oauth_states (state_hash, user_id, project_id, expires_at) VALUES ($1, $2, $3, $4)', [stateHash, userId, projectId, expiresAt]);
    },
    async consumeOAuthState(stateHash: string): Promise<OAuthStateConsumeResult> {
      const consumed = await database.query('UPDATE oauth_states SET used_at = now() WHERE state_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id, project_id', [stateHash]);
      if (consumed.rows[0]) return { status: 'consumed', ...consumed.rows[0] };
      const { rows } = await database.query('SELECT expires_at, used_at FROM oauth_states WHERE state_hash = $1', [stateHash]);
      return rows[0] && new Date(rows[0].expires_at).getTime() <= Date.now() ? { status: 'expired' } : { status: 'invalid' };
    },
    async getConnection(projectId: string): Promise<LinkedInConnectionRecord | null> {
      const { rows } = await database.query(`SELECT id, project_id, linkedin_member_id, author_urn, display_name, profile_picture_url,
        access_token_expires_at, refresh_token_expires_at, scopes, status, created_at, updated_at
        FROM linkedin_connections WHERE project_id = $1 ORDER BY (status = 'ACTIVE') DESC, created_at DESC LIMIT 1`, [projectId]);
      return rows[0] ?? null;
    },
    async getActiveConnectionForDisconnect(projectId: string): Promise<{ id: string; access_token_encrypted: string; linkedin_member_id: string; status: string } | null> {
      const { rows } = await database.query(`SELECT id, access_token_encrypted, linkedin_member_id, status
        FROM linkedin_connections WHERE project_id = $1 AND status = 'ACTIVE' LIMIT 1`, [projectId]);
      return rows[0] ?? null;
    },
    async setExpired(connectionId: string): Promise<void> {
      await database.query("UPDATE linkedin_connections SET status = 'EXPIRED' WHERE id = $1 AND status = 'ACTIVE'", [connectionId]);
    },
    async isAllowed(projectId: string, userId: string): Promise<boolean> {
      const { rows } = await database.query(`SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2
        AND linkedin_module_access = true AND role IN ('ADMIN','EDITOR')`, [projectId, userId]);
      return Boolean(rows[0]);
    },
    async disconnect(projectId: string): Promise<void> {
      await database.query(`UPDATE linkedin_connections SET status = 'REVOKED', access_token_encrypted = NULL,
        refresh_token_encrypted = NULL, refresh_token_expires_at = NULL WHERE project_id = $1 AND status = 'ACTIVE'`, [projectId]);
    },
    async connect({ projectId, userId, memberId, authorUrn, displayName, pictureUrl, accessTokenEncrypted, refreshTokenEncrypted, expiresAt, refreshExpiresAt, scopes }: ConnectParams): Promise<{ id: string; replacedCount: number }> {
      const client = await database.connect();
      try {
        await client.query('BEGIN');
        const old = await client.query(`UPDATE linkedin_connections SET status = 'REVOKED', access_token_encrypted = NULL,
          refresh_token_encrypted = NULL, refresh_token_expires_at = NULL WHERE project_id = $1 AND status = 'ACTIVE' RETURNING id`, [projectId]);
        const inserted = await client.query(`INSERT INTO linkedin_connections
          (project_id, created_by_user_id, linkedin_member_id, author_urn, display_name, profile_picture_url,
           access_token_encrypted, refresh_token_encrypted, access_token_expires_at, refresh_token_expires_at, scopes, status)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACTIVE') RETURNING id`,
        [projectId, userId, memberId, authorUrn, displayName, pictureUrl, accessTokenEncrypted, refreshTokenEncrypted, expiresAt, refreshExpiresAt, scopes]);
        await client.query('UPDATE linkedin_posts SET connection_id = $2 WHERE project_id = $1', [projectId, inserted.rows[0].id]);
        await client.query('COMMIT');
        return { id: inserted.rows[0].id, replacedCount: old.rowCount ?? 0 };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
  });
}

export const connectionData = createConnectionData();
