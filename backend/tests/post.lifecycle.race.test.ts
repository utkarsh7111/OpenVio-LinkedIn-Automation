import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createPostData } from '../src/db/post.data.js';
import { createPostService } from '../src/services/post.service.js';
import { encryptToken } from '../src/utils/crypto.js';

const connectionString = process.env.TEST_DATABASE_URL;
const skip = connectionString ? false : 'set TEST_DATABASE_URL to run PostgreSQL workflow tests';
const KEY = 'c'.repeat(64);

async function fixture() {
  const database = new pg.Pool({ connectionString });
  const projectId = (await database.query("INSERT INTO projects(name) VALUES ('lifecycle-race-test') RETURNING id")).rows[0].id;
  const userId = (await database.query("INSERT INTO dev_users(name, role) VALUES ('lifecycle-race-test', 'ADMIN') RETURNING id")).rows[0].id;
  await database.query(`INSERT INTO linkedin_connections (project_id, created_by_user_id, linkedin_member_id, author_urn, access_token_encrypted, access_token_expires_at)
    VALUES ($1,$2,$3,'urn:li:person:race-member',$4, now() + interval '1 hour')`, [projectId, userId, `race-${projectId}`, encryptToken('race-token', KEY)]);
  const data = createPostData(database);
  const publishCalls: any[] = [];
  const hooks = { duringPublish: async () => {} };
  const linkedin = { async publishPost(_connection: any, input: any) { publishCalls.push(input); await hooks.duringPublish(); return { urn: 'urn:li:share:race1' }; }, async uploadImage() { throw new Error('not used'); }, async updatePost() {}, async deletePost() {} };
  const service = createPostService({ data, linkedin: linkedin as any, notify: { notify: async () => {} } });
  const cleanup = async () => { await database.query('DELETE FROM projects WHERE id = $1', [projectId]).catch(() => {}); await database.query('DELETE FROM dev_users WHERE id = $1', [userId]).catch(() => {}); await database.end(); };
  return { database, data, service, projectId, userId, publishCalls, hooks, cleanup };
}
const rejects409 = (promise: Promise<any>) => assert.rejects(promise, (error: any) => error.status === 409);
const statusOf = async (database: any, id: string) => (await database.query('SELECT status, deleted_at, content FROM linkedin_posts WHERE id = $1', [id])).rows[0];

test('a post that is PUBLISHING cannot be rescheduled, edited, unscheduled or deleted', { skip }, async () => {
  const f = await fixture();
  try {
    const { post } = await f.data.create({ projectId: f.projectId, userId: f.userId, content: 'original', media: [], aiGenerated: false });
    await f.database.query("UPDATE linkedin_posts SET status = 'PUBLISHING', publishing_started_at = now() WHERE id = $1", [post.id]);
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await rejects409(f.service.schedule(post.id, f.projectId, future, f.userId));
    await rejects409(f.service.update(post.id, f.projectId, { content: 'changed mid-publish' }, f.userId));
    await rejects409(f.service.unschedule(post.id, f.projectId, f.userId));
    await rejects409(f.service.remove(post.id, f.projectId));
    const row = await statusOf(f.database, post.id);
    assert.equal(row.status, 'PUBLISHING');
    assert.equal(row.deleted_at, null);
    assert.equal(row.content, 'original');
  } finally { await f.cleanup(); }
});

test('rescheduling during an in-flight publish cannot cause a second LinkedIn post', { skip }, async () => {
  const f = await fixture();
  try {
    const { post } = await f.data.create({ projectId: f.projectId, userId: f.userId, content: 'publish once', media: [], aiGenerated: false });
    let interference: any;
    f.hooks.duringPublish = async () => {
      interference = await Promise.allSettled([f.service.schedule(post.id, f.projectId, new Date(Date.now() + 600_000).toISOString(), f.userId), f.service.remove(post.id, f.projectId)]);
    };
    const published = await f.service.publish(post.id, f.projectId, f.userId);
    assert.equal(published.status, 'PUBLISHED');
    assert.ok(interference.every((outcome: any) => outcome.status === 'rejected'), 'schedule and delete must be refused while publishing');
    const row = await statusOf(f.database, post.id);
    assert.equal(row.status, 'PUBLISHED');
    assert.equal(row.deleted_at, null);
    assert.equal(f.publishCalls.length, 1);
  } finally { await f.cleanup(); }
});
