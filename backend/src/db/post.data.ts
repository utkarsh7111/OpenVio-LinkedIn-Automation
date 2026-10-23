import { pool } from './pool.js';

async function transaction<T>(database: any, fn: (client: any) => Promise<T>): Promise<T> {
  const client = await database.connect();
  try { await client.query('BEGIN'); const value = await fn(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

const POST_COLUMNS = `id, project_id AS "projectId", connection_id AS "connectionId", content, media,
  status, scheduled_at AS "scheduledAt", published_at AS "publishedAt", linkedin_post_urn AS "linkedinPostUrn",
  error_code AS "errorCode", error_message AS "errorMessage", retry_count AS "retryCount", ai_generated AS "aiGenerated",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export interface PostRecord {
  id: string;
  projectId: string;
  connectionId: string | null;
  content: string;
  media: any;
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  linkedinPostUrn: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryCount: number;
  aiGenerated: boolean;
  createdAt: string;
  updatedAt: string;
  events?: any[];
}

export interface PostCreateInput {
  projectId: string;
  userId: string;
  content: string;
  media: any[];
  scheduledAt?: string | null;
  aiGenerated?: boolean;
  idempotencyKey?: string | null;
}

export interface PostListQuery {
  projectId: string;
  status?: string;
  page: number;
  limit: number;
  q?: string;
}

export type ListPostsQuery = PostListQuery;
export type ListPostsResult = { items: PostRecord[]; total: number };

export interface PostUpdateInput {
  id: string;
  projectId: string;
  content?: string;
  media?: any[];
  scheduledAt?: string | null;
  clearScheduledAt?: boolean;
  status?: string;
  clearError?: boolean;
  actorUserId?: string | null;
  detail?: string | null;
}

export interface PostData {
  getProjectId(id: string): Promise<string | null>;
  create(input: PostCreateInput): Promise<{ post: PostRecord; created: boolean }>;
  get(id: string, projectId: string, includeEvents?: boolean): Promise<PostRecord | null>;
  list(query: PostListQuery): Promise<{ items: PostRecord[]; total: number }>;
  update(input: PostUpdateInput): Promise<PostRecord | null>;
  claim(params: { id: string; projectId: string; actorUserId?: string | null; connectionId: string; retryOnly?: boolean }): Promise<PostRecord | null>;
  setPublished(params: { id: string; projectId: string; urn: string; actorUserId?: string | null }): Promise<PostRecord | null>;
  setFailed(params: { id: string; projectId: string; code: string; message: string; actorUserId?: string | null }): Promise<PostRecord | null>;
  claimDuePosts(params: { now: Date; limit: number }): Promise<PostRecord[]>;
  setScheduledRetry(params: { id: string; projectId: string; scheduledAt: string; code: string; message: string; actorUserId?: string | null }): Promise<PostRecord | null>;
  recoverStuckPublishing(params: { cutoff: Date; now: Date; retryLimit?: number; limit?: number }): Promise<any[]>;
  saveImageUrn(params: { id: string; projectId: string; imageIndex: number; urn: string }): Promise<PostRecord | null>;
  softDelete(id: string, projectId: string): Promise<{ id: string } | null>;
  getActiveConnection(projectId: string): Promise<any>;
  getNotifications(projectId: string, limit: number): Promise<any[]>;
  markConnectionExpired(projectId: string): Promise<void>;
}

export function createPostData(database: any = pool): PostData {
  return Object.freeze({
    async getProjectId(id: string): Promise<string | null> {
      const { rows } = await database.query('SELECT project_id AS "projectId" FROM linkedin_posts WHERE id = $1 AND deleted_at IS NULL', [id]);
      return rows[0]?.projectId ?? null;
    },
    async create({ projectId, userId, content, media, scheduledAt, aiGenerated, idempotencyKey }: PostCreateInput): Promise<{ post: PostRecord; created: boolean }> {
      if (idempotencyKey) {
        const { rows } = await database.query(`SELECT ${POST_COLUMNS} FROM linkedin_posts WHERE project_id = $1 AND idempotency_key = $2`, [projectId, idempotencyKey]);
        if (rows[0]) return { post: rows[0], created: false };
      }
      const status = scheduledAt ? 'SCHEDULED' : 'DRAFT';
      try {
        return await transaction(database, async (client) => {
          const { rows } = await client.query(`INSERT INTO linkedin_posts
            (project_id, created_by_user_id, content, media, scheduled_at, status, ai_generated, idempotency_key)
            VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8) RETURNING ${POST_COLUMNS}`,
          [projectId, userId, content, JSON.stringify(media), scheduledAt, status, aiGenerated, idempotencyKey ?? null]);
          if (status === 'SCHEDULED') await client.query(`INSERT INTO linkedin_post_events(post_id, project_id, from_status, to_status, actor_user_id, detail) VALUES ($1,$2,'DRAFT','SCHEDULED',$3,'Scheduled on create')`, [rows[0].id, projectId, userId]);
          return { post: rows[0], created: true };
        });
      } catch (error: any) {
        if (error.code !== '23505' || !idempotencyKey) throw error;
        const { rows } = await database.query(`SELECT ${POST_COLUMNS} FROM linkedin_posts WHERE project_id = $1 AND idempotency_key = $2`, [projectId, idempotencyKey]);
        if (rows[0]) return { post: rows[0], created: false };
        throw error;
      }
    },
    async get(id: string, projectId: string, includeEvents: boolean = false): Promise<PostRecord | null> {
      const { rows } = await database.query(`SELECT ${POST_COLUMNS} FROM linkedin_posts WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`, [id, projectId]);
      if (!rows[0] || !includeEvents) return rows[0] ?? null;
      const events = await database.query(`SELECT id, post_id AS "postId", from_status AS "fromStatus", to_status AS "toStatus",
        actor_user_id AS "actorUserId", detail, created_at AS "createdAt" FROM linkedin_post_events
        WHERE post_id = $1 AND project_id = $2 ORDER BY created_at DESC, id DESC`, [id, projectId]);
      return { ...rows[0], events: events.rows };
    },
    async list({ projectId, status, page, limit, q }: PostListQuery): Promise<{ items: PostRecord[]; total: number }> {
      const params: any[] = [projectId];
      const where: string[] = ['project_id = $1', 'deleted_at IS NULL'];
      if (status) { params.push(status); where.push(`status = $${params.length}`); }
      if (q) { params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`); where.push(`content ILIKE $${params.length} ESCAPE '\\'`); }
      const count = await database.query(`SELECT count(*)::int AS total FROM linkedin_posts WHERE ${where.join(' AND ')}`, params);
      params.push(limit, (page - 1) * limit);
      const items = await database.query(`SELECT ${POST_COLUMNS} FROM linkedin_posts WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
      return { items: items.rows, total: count.rows[0].total };
    },
    async update({ id, projectId, content, media, scheduledAt, clearScheduledAt, status, clearError, actorUserId, detail }: PostUpdateInput): Promise<PostRecord | null> {
      return transaction(database, async (client) => {
        const current = await client.query('SELECT status FROM linkedin_posts WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL FOR UPDATE', [id, projectId]);
        if (!current.rows[0]) return null;
        const from = current.rows[0].status;
        if (from === 'PUBLISHING') return null; // never mutate a post while LinkedIn publication is in flight
        const to = status ?? from;
        const sets = ['content = COALESCE($3, content)', 'media = COALESCE($4::jsonb, media)', 'scheduled_at = CASE WHEN $7 THEN NULL ELSE COALESCE($5, scheduled_at) END', 'status = $6'];
        if (clearError) sets.push('error_code = NULL', 'error_message = NULL', 'last_error_at = NULL');
        const { rows } = await client.query(`UPDATE linkedin_posts SET ${sets.join(', ')} WHERE id = $1 AND project_id = $2 RETURNING ${POST_COLUMNS}`,
          [id, projectId, content ?? null, media === undefined ? null : JSON.stringify(media), scheduledAt ?? null, to, Boolean(clearScheduledAt)]);
        if (to !== from) await client.query(`INSERT INTO linkedin_post_events(post_id, project_id, from_status, to_status, actor_user_id, detail) VALUES ($1,$2,$3,$4,$5,$6)`, [id, projectId, from, to, actorUserId ?? null, detail?.slice(0, 500) ?? null]);
        return rows[0];
      });
    },
    async claim({ id, projectId, actorUserId, connectionId, retryOnly = false }: { id: string; projectId: string; actorUserId?: string | null; connectionId: string; retryOnly?: boolean }): Promise<PostRecord | null> {
      return transaction(database, async (client) => {
        const allowed = retryOnly ? ['FAILED'] : ['DRAFT', 'SCHEDULED', 'FAILED'];
        const current = await client.query('SELECT status FROM linkedin_posts WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL FOR UPDATE', [id, projectId]);
        if (!current.rows[0] || !allowed.includes(current.rows[0].status)) return null;
        const from = current.rows[0].status;
        const { rows } = await client.query(`UPDATE linkedin_posts SET status = 'PUBLISHING', publishing_started_at = now(), connection_id = $4
          WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL AND status = $3 RETURNING ${POST_COLUMNS}`, [id, projectId, from, connectionId]);
        if (!rows[0]) return null;
        await client.query('INSERT INTO linkedin_post_events(post_id, project_id, from_status, to_status, actor_user_id, detail) VALUES ($1,$2,$3,\'PUBLISHING\',$4,$5)', [id, projectId, from, actorUserId ?? null, 'Publish claimed']);
        return rows[0];
      });
    },
    async setPublished({ id, projectId, urn, actorUserId }: { id: string; projectId: string; urn: string; actorUserId?: string | null }): Promise<PostRecord | null> {
      return transaction(database, async (client) => {
        const { rows } = await client.query(`UPDATE linkedin_posts SET status = 'PUBLISHED', linkedin_post_urn = $3, published_at = now(),
          publishing_started_at = NULL, error_code = NULL, error_message = NULL, last_error_at = NULL
          WHERE id = $1 AND project_id = $2 AND status = 'PUBLISHING' RETURNING ${POST_COLUMNS}`, [id, projectId, urn]);
        if (!rows[0]) return null;
        await client.query(`INSERT INTO linkedin_post_events(post_id, project_id, from_status, to_status, actor_user_id, detail) VALUES ($1,$2,'PUBLISHING','PUBLISHED',$3,'Published')`, [id, projectId, actorUserId ?? null]);
        return rows[0];
      });
    },
    async setFailed({ id, projectId, code, message, actorUserId }: { id: string; projectId: string; code: string; message: string; actorUserId?: string | null }): Promise<PostRecord | null> {
      return transaction(database, async (client) => {
        const { rows } = await client.query(`UPDATE linkedin_posts SET status = 'FAILED', publishing_started_at = NULL,
          error_code = $3, error_message = $4, retry_count = retry_count + 1, last_error_at = now()
          WHERE id = $1 AND project_id = $2 AND status = 'PUBLISHING' RETURNING ${POST_COLUMNS}`, [id, projectId, code, message.slice(0, 1000)]);
        if (!rows[0]) return null;
        await client.query(`INSERT INTO linkedin_post_events(post_id, project_id, from_status, to_status, actor_user_id, detail) VALUES ($1,$2,'PUBLISHING','FAILED',$3,$4)`, [id, projectId, actorUserId ?? null, code]);
        return rows[0];
      });
    },
    async claimDuePosts({ now, limit }: { now: Date; limit: number }): Promise<PostRecord[]> {
      return transaction(database, async (client) => {
        const { rows } = await client.query(`WITH due AS (
          SELECT id, project_id, status FROM linkedin_posts
          WHERE status = 'SCHEDULED' AND scheduled_at <= $1 AND deleted_at IS NULL
          ORDER BY scheduled_at, id LIMIT $2 FOR UPDATE SKIP LOCKED
        )
        UPDATE linkedin_posts AS p SET status = 'PUBLISHING', publishing_started_at = $1
        FROM due WHERE p.id = due.id AND p.project_id = due.project_id
        RETURNING p.id, p.project_id AS "projectId", p.connection_id AS "connectionId", p.content, p.media,
          p.status, p.scheduled_at AS "scheduledAt", p.published_at AS "publishedAt", p.linkedin_post_urn AS "linkedinPostUrn",
          p.error_code AS "errorCode", p.error_message AS "errorMessage", p.retry_count AS "retryCount", p.ai_generated AS "aiGenerated",
          p.created_at AS "createdAt", p.updated_at AS "updatedAt"`, [now, limit]);
        for (const post of rows) await client.query(`INSERT INTO linkedin_post_events(post_id, project_id, from_status, to_status, actor_user_id, detail)
          VALUES ($1,$2,'SCHEDULED','PUBLISHING',NULL,'Scheduler claimed')`, [post.id, post.projectId]);
        return rows;
      });
    },
    async setScheduledRetry({ id, projectId, scheduledAt, code, message, actorUserId = null }: { id: string; projectId: string; scheduledAt: string; code: string; message: string; actorUserId?: string | null }): Promise<PostRecord | null> {
      return transaction(database, async (client) => {
        const { rows } = await client.query(`UPDATE linkedin_posts SET status = 'SCHEDULED', scheduled_at = $3,
          publishing_started_at = NULL, error_code = $4, error_message = $5, retry_count = retry_count + 1, last_error_at = now()
          WHERE id = $1 AND project_id = $2 AND status = 'PUBLISHING' RETURNING ${POST_COLUMNS}`,
        [id, projectId, scheduledAt, code, message.slice(0, 1000)]);
        if (!rows[0]) return null;
        await client.query(`INSERT INTO linkedin_post_events(post_id, project_id, from_status, to_status, actor_user_id, detail)
          VALUES ($1,$2,'PUBLISHING','SCHEDULED',$3,$4)`, [id, projectId, actorUserId, `Retry scheduled: ${code}`]);
        return rows[0];
      });
    },
    async recoverStuckPublishing({ cutoff, now, retryLimit = 3, limit = 500 }: { cutoff: Date; now: Date; retryLimit?: number; limit?: number }): Promise<any[]> {
      return transaction(database, async (client) => {
        const locked = await client.query(`SELECT id, project_id AS "projectId", linkedin_post_urn AS "linkedinPostUrn", retry_count AS "retryCount"
          FROM linkedin_posts WHERE status = 'PUBLISHING' AND publishing_started_at <= $1 AND deleted_at IS NULL
          ORDER BY publishing_started_at, id LIMIT $2 FOR UPDATE SKIP LOCKED`, [cutoff, limit]);
        const recovered: any[] = [];
        for (const row of locked.rows) {
          let nextStatus: string;
          let code: string | null = null;
          if (row.linkedinPostUrn) {
            nextStatus = 'PUBLISHED';
            await client.query(`UPDATE linkedin_posts SET status='PUBLISHED', published_at=COALESCE(published_at,$3), publishing_started_at=NULL
              WHERE id=$1 AND project_id=$2`, [row.id, row.projectId, now]);
          } else if (row.retryCount >= retryLimit) {
            nextStatus = 'FAILED'; code = 'LINKEDIN_UNAVAILABLE';
            await client.query(`UPDATE linkedin_posts SET status='FAILED', publishing_started_at=NULL, error_code=$3,
              error_message='LinkedIn is not responding. Try again in a few minutes.', last_error_at=$4 WHERE id=$1 AND project_id=$2`, [row.id, row.projectId, code, now]);
          } else {
            nextStatus = 'SCHEDULED'; code = 'LINKEDIN_UNAVAILABLE';
            await client.query(`UPDATE linkedin_posts SET status='SCHEDULED', scheduled_at=$3, publishing_started_at=NULL,
              retry_count=retry_count+1, error_code=$4, error_message='LinkedIn is not responding. Try again in a few minutes.', last_error_at=$3
              WHERE id=$1 AND project_id=$2`, [row.id, row.projectId, now, code]);
          }
          await client.query(`INSERT INTO linkedin_post_events(post_id, project_id, from_status, to_status, actor_user_id, detail)
            VALUES ($1,$2,'PUBLISHING',$3,NULL,$4)`, [row.id, row.projectId, nextStatus, code ? `Recovery: ${code}` : 'Recovered with LinkedIn URN']);
          recovered.push({ ...row, outcome: nextStatus === 'PUBLISHED' ? 'RECOVERED_PUBLISHED' : nextStatus === 'SCHEDULED' ? 'RECOVERED_SCHEDULED' : 'FAILED', code });
        }
        return recovered;
      });
    },
    async saveImageUrn({ id, projectId, imageIndex, urn }: { id: string; projectId: string; imageIndex: number; urn: string }): Promise<PostRecord | null> {
      const { rows } = await database.query(`UPDATE linkedin_posts SET media = jsonb_set(media, ARRAY[$3::text,'linkedinImageUrn'], to_jsonb($4::text), true)
        WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL RETURNING ${POST_COLUMNS}`, [id, projectId, String(imageIndex), urn]);
      return rows[0] ?? null;
    },
    async softDelete(id: string, projectId: string): Promise<{ id: string } | null> {
      const { rows } = await database.query(`UPDATE linkedin_posts SET deleted_at = now() WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL AND status <> 'PUBLISHING' RETURNING id`, [id, projectId]);
      return rows[0] ?? null;
    },
    async getActiveConnection(projectId: string): Promise<any> {
      const { rows } = await database.query(`SELECT id, project_id AS "projectId", author_urn AS "authorUrn", status,
        access_token_encrypted, access_token_expires_at FROM linkedin_connections WHERE project_id = $1 AND status IN ('ACTIVE','EXPIRED')
        ORDER BY (status = 'ACTIVE') DESC, created_at DESC LIMIT 1`, [projectId]);
      return rows[0] ?? null;
    },
    async getNotifications(projectId: string, limit: number): Promise<any[]> {
      const { rows } = await database.query(`SELECT n.id, n.post_id AS "postId", n.type, n.message, n.created_at AS "createdAt"
        FROM notifications_log n JOIN linkedin_posts p ON p.id = n.post_id
        WHERE p.project_id = $1 ORDER BY n.created_at DESC LIMIT $2`, [projectId, limit]);
      return rows;
    },
    async markConnectionExpired(projectId: string): Promise<void> {
      await database.query(`UPDATE linkedin_connections SET status = 'EXPIRED' WHERE project_id = $1 AND status = 'ACTIVE'`, [projectId]);
    },
  });
}

export const postData = createPostData();
