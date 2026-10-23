import test from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import pg from 'pg';
import { createMockServer } from '../../mock-linkedin/server.js';
import { createPostData } from '../src/db/post.data.js';
import { createPostService } from '../src/services/post.service.js';
import { createLinkedInService } from '../src/services/linkedin.service.js';
import { encryptToken } from '../src/utils/crypto.js';

const connectionString = process.env.TEST_DATABASE_URL;
test('PostgreSQL publish claim allows one concurrent LinkedIn create', { skip: connectionString ? false : 'set TEST_DATABASE_URL to run PostgreSQL workflow tests' }, async () => {
  const database = new pg.Pool({ connectionString });
  const mock: any = createMockServer();
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', () => resolve()));
  let projectId: string | undefined;
  let userId: string | undefined;
  try {
    const project = await database.query("INSERT INTO projects(name) VALUES ('publish-concurrency-test') RETURNING id");
    projectId = project.rows[0].id;
    const user = await database.query("INSERT INTO dev_users(name, role) VALUES ('publish-concurrency-test', 'ADMIN') RETURNING id");
    userId = user.rows[0].id;
    const rawToken = 'postgres-publish-concurrency-token';
    const key = 'e'.repeat(64);
    mock.mockState.tokens.set(rawToken, { sub: 'mock-member-001', scope: 'openid profile w_member_social', expiresAt: Date.now() + 60_000 });
    await database.query(`INSERT INTO linkedin_connections
      (project_id, created_by_user_id, linkedin_member_id, author_urn, access_token_encrypted, access_token_expires_at)
      VALUES ($1,$2,$3,'urn:li:person:mock-member-001',$4,now() + interval '1 hour') RETURNING id`, [projectId, userId, `test-${projectId}`, encryptToken(rawToken, key)]);
    const data = createPostData(database);
    const created = await data.create({ projectId: projectId!, userId: userId!, content: 'only one provider create', media: [], aiGenerated: false });
    let providerCreates = 0;
    const linkedin = createLinkedInService({ config: { linkedinApiBase: `http://127.0.0.1:${(mock.address() as AddressInfo).port}`, linkedinApiVersion: '202601', linkedinHttpTimeoutMs: 1000, tokenEncryptionKey: key } as any, fetchImpl: async (url: any, options: any) => { if (new URL(url).pathname === '/rest/posts' && options.method === 'POST') providerCreates += 1; return fetch(url, options); } });
    const service = createPostService({ data, linkedin: linkedin as any, notify: { notify: async () => {} } });
    const outcomes = await Promise.allSettled([
      service.publish(created.post.id, projectId!, userId!),
      service.publish(created.post.id, projectId!, userId!),
    ]);
    assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((item) => item.status === 'rejected').length, 1);
    assert.equal(providerCreates, 1);
    assert.equal((await database.query('SELECT status FROM linkedin_posts WHERE id = $1', [created.post.id])).rows[0].status, 'PUBLISHED');
    assert.equal((await database.query("SELECT count(*)::int AS count FROM linkedin_post_events WHERE post_id = $1 AND to_status = 'PUBLISHING'", [created.post.id])).rows[0].count, 1);
  } finally {
    if (projectId) await database.query('DELETE FROM projects WHERE id = $1', [projectId]).catch(() => {});
    if (userId) await database.query('DELETE FROM dev_users WHERE id = $1', [userId]).catch(() => {});
    await Promise.all([database.end(), new Promise<void>((resolve) => mock.close(() => resolve()))]);
  }
});
