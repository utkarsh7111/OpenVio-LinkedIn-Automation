import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessDuePosts } from '../src/jobs/processDuePosts.js';
import { createPostService } from '../src/services/post.service.js';
import { createPostData } from '../src/db/post.data.js';

const config = { schedulerBatchSize: 20, missedWindowHours: 6, stuckPublishingMinutes: 10 } as any;
const date = '2026-10-17T10:00:00.000Z';

function fixture({ posts = [] as any[] } = {}) {
  const rows = new Map<string, any>(posts.map((post) => [post.id, { status: 'SCHEDULED', retryCount: 0, ...post }]));
  const events: string[] = [];
  const notices: any[] = [];
  const logs: any[] = [];
  const recovery: any[] = [];
  const data: any = {
    async claimDuePosts({ now, limit }: { now: Date; limit: number }) {
      const due = [...rows.values()].filter((row) => row.status === 'SCHEDULED' && new Date(row.scheduledAt) <= now).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)).slice(0, limit);
      for (const row of due) { row.status = 'PUBLISHING'; events.push(`${row.id}:SCHEDULED>PUBLISHING`); }
      return due.map((row) => ({ ...row }));
    },
    async setFailed({ id, projectId, code, message }: any) {
      const row = rows.get(id); row.status = 'FAILED'; row.errorCode = code; row.errorMessage = message; row.retryCount += 1; events.push(`${id}:PUBLISHING>FAILED`); return row;
    },
    async setScheduledRetry({ id, scheduledAt, code, message }: any) {
      const row = rows.get(id); row.status = 'SCHEDULED'; row.scheduledAt = scheduledAt; row.errorCode = code; row.errorMessage = message; row.retryCount += 1; events.push(`${id}:PUBLISHING>SCHEDULED`); return row;
    },
    async recoverStuckPublishing() { const result = recovery.splice(0); for (const row of result) { const record = rows.get(row.id); if (record) record.status = row.outcome === 'RECOVERED_PUBLISHED' ? 'PUBLISHED' : row.outcome === 'FAILED' ? 'FAILED' : 'SCHEDULED'; } return result; },
  };
  return { rows, events, notices, logs, data, recovery };
}

function post(id: string, scheduledAt = date) { return { id, projectId: 'project-1', scheduledAt, retryCount: 0, content: 'private content', media: [] }; }

test('claims due posts only and recovers stale claims after processing', async () => {
  const f = fixture({ posts: [post('due'), post('future', '2026-10-17T10:01:00.000Z')] });
  const job = createProcessDuePosts({ data: f.data, posts: { publishClaimed: async () => ({ outcome: 'PUBLISHED' }) } as any, notify: { notify: async (...args: any[]) => f.notices.push(args) }, config, clock: () => new Date(date), logger: { info: (line: string) => f.logs.push(JSON.parse(line)) } });
  assert.deepEqual(await job(), { claimed: 1, published: 1, recovered: 0 });
  assert.equal(f.rows.get('due').status, 'PUBLISHING');
  assert.equal(f.rows.get('future').status, 'SCHEDULED');
});

test('parallel scheduler executions claim and publish a post exactly once', async () => {
  const f = fixture({ posts: [post('one')] });
  let providerCalls = 0;
  let release!: () => void;
  const posts = { publishClaimed: async () => { providerCalls += 1; await new Promise<void>((resolve) => { release = resolve; }); return { outcome: 'PUBLISHED' }; } };
  const job = createProcessDuePosts({ data: f.data, posts: posts as any, notify: { notify: async () => {} }, config, clock: () => new Date(date), logger: { info() {} } });
  const first = job();
  await new Promise((resolve) => setImmediate(resolve));
  await job();
  assert.equal(providerCalls, 1);
  release(); await first;
});

test('missed window fails without calling LinkedIn and logs safely', async () => {
  const f = fixture({ posts: [post('missed', '2026-10-17T03:59:59.000Z')] });
  let calls = 0;
  const job = createProcessDuePosts({ data: f.data, posts: { publishClaimed: async () => { calls += 1; } } as any, notify: { notify: async (entry: any) => f.notices.push(entry) }, config, clock: () => new Date(date), logger: { info: (line: string) => f.logs.push(JSON.parse(line)) } });
  await job();
  assert.equal(calls, 0); assert.equal(f.rows.get('missed').errorCode, 'MISSED_WINDOW');
  assert.equal(f.notices[0].type, 'POST_FAILED');
  assert.deepEqual(Object.keys(f.logs[0]).sort(), ['durationMs', 'outcome', 'postId', 'projectId']);
  assert.doesNotMatch(JSON.stringify(f.logs), /private content/);
});

test('one failure does not stop later posts in the batch', async () => {
  const f = fixture({ posts: [post('bad'), post('good')] });
  const attempted: string[] = [];
  const job = createProcessDuePosts({ data: f.data, posts: { publishClaimed: async (id: string) => { attempted.push(id); if (id === 'bad') throw new Error('secret token'); return { outcome: 'PUBLISHED' }; } } as any, notify: { notify: async () => {} }, config, clock: () => new Date(date), logger: { info: (line: string) => f.logs.push(JSON.parse(line)) } });
  await job();
  assert.deepEqual(attempted, ['bad', 'good']);
  assert.equal(f.rows.get('bad').status, 'FAILED');
  assert.equal(f.logs.length, 2);
  assert.doesNotMatch(JSON.stringify(f.logs), /secret token/);
});

test('recovery handles both a stored URN and an uncertain post without one', async () => {
  const f = fixture({ posts: [{ ...post('has-urn'), status: 'PUBLISHING' }, { ...post('no-urn'), status: 'PUBLISHING' }] });
  f.recovery.push({ id: 'has-urn', projectId: 'project-1', outcome: 'RECOVERED_PUBLISHED' }, { id: 'no-urn', projectId: 'project-1', outcome: 'RECOVERED_SCHEDULED' });
  const job = createProcessDuePosts({ data: f.data, posts: { publishClaimed: async () => assert.fail('should not publish') } as any, notify: { notify: async () => {} }, config, clock: () => new Date(date), logger: { info() {} } });
  assert.equal((await job()).recovered, 2);
  assert.equal(f.rows.get('has-urn').status, 'PUBLISHED');
  assert.equal(f.rows.get('no-urn').status, 'SCHEDULED');
});

test('stuck PUBLISHING recovery uses the LinkedIn URN to avoid a second publish', async () => {
  const calls: any[] = [];
  const data: any = { claimDuePosts: async () => [], recoverStuckPublishing: async (args: any) => { calls.push(args); return []; } };
  const job = createProcessDuePosts({ data, posts: {} as any, notify: {} as any, config, clock: () => new Date(date), logger: { info() {} } });
  await job();
  assert.equal(calls[0].cutoff.toISOString(), '2026-10-17T09:50:00.000Z');
  assert.equal(calls[0].retryLimit, 3);
});

test('database claiming uses SKIP LOCKED and recovery updates URN, retry, and exhausted branches', async () => {
  const queries: string[] = [];
  const client = { async query(sql: string) {
    queries.push(sql);
    if (sql.includes('SELECT id, project_id AS "projectId", linkedin_post_urn')) return { rows: [
      { id: 'urn', projectId: 'project-1', linkedinPostUrn: 'urn:li:share:1', retryCount: 0 },
      { id: 'retry', projectId: 'project-1', linkedinPostUrn: null, retryCount: 2 },
      { id: 'exhausted', projectId: 'project-1', linkedinPostUrn: null, retryCount: 3 },
    ] };
    return { rows: [] };
  }, release() {} };
  const database = { connect: async () => client, query: async (sql: string, params?: any[]) => client.query(sql) };
  const data = createPostData(database as any);
  const outcomes = await data.recoverStuckPublishing({ cutoff: new Date(date), now: new Date(date), retryLimit: 3 });
  assert.deepEqual(outcomes.map((row) => row.outcome), ['RECOVERED_PUBLISHED', 'RECOVERED_SCHEDULED', 'FAILED']);
  assert.match(queries.find((sql) => sql.includes('SELECT id, project_id AS "projectId", linkedin_post_urn'))!, /linkedin_post_urn/);
  assert.match(queries.find((sql) => sql.includes("status='SCHEDULED', scheduled_at"))!, /retry_count=retry_count\+1/);
  assert.match(queries.find((sql) => sql.includes("status='FAILED'"))!, /status='FAILED'/);
  let claimSql: string | undefined;
  client.query = async (sql: string) => { if (sql.includes('WITH due')) claimSql = sql; return { rows: [] }; };
  await data.claimDuePosts({ now: new Date(date), limit: 10 });
  assert.match(claimSql!, /FOR UPDATE SKIP LOCKED/);
  assert.match(claimSql!, /scheduled_at <= \$1/);
});

test('scheduler publish retries at 5, 15, and 60 minutes using the controlled clock', async () => {
  let now = new Date(date);
  const scheduled: Date[] = [];
  let current: any = { id: 'retry', projectId: 'project-1', retryCount: 0, content: 'text', media: [] };
  const data = {
    getActiveConnection: async () => ({ id: 'conn', authorUrn: 'urn:li:person:1', status: 'ACTIVE', access_token_expires_at: new Date('2027-01-01') }),
    setScheduledRetry: async (input: any) => { scheduled.push(new Date(input.scheduledAt)); current.retryCount += 1; return current; },
    setFailed: async (input: any) => { current.retryCount += 1; current.failure = input; return current; },
    markConnectionExpired: async () => {},
  };
  const service = createPostService({ data: data as any, linkedin: { publishPost: async () => { const error: any = new Error('hidden'); error.code = 'LINKEDIN_UNAVAILABLE'; throw error; } } as any, storage: {} as any, notify: { notify: async () => {} }, clock: () => now });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await service.publishClaimed('retry', 'project-1', current);
    assert.equal(result.outcome, 'RETRY_SCHEDULED');
    now = new Date(scheduled.at(-1)!);
  }
  assert.deepEqual(scheduled.map((at) => (at.getTime() - new Date(date).getTime()) / 60_000), [5, 20, 80]);
  assert.equal(current.retryCount, 3);
  const final = await service.publishClaimed('retry', 'project-1', current);
  assert.equal(final.outcome, 'FAILED');
  assert.equal(current.retryCount, 4);
});

test('expired or disconnected connections fail safely without calling LinkedIn', async () => {
  for (const connection of [{ status: 'EXPIRED' }, null]) {
    let failed: any;
    let called = false;
    const data = { getActiveConnection: async () => connection, markConnectionExpired: async () => {}, setFailed: async (input: any) => { failed = input; } };
    const service = createPostService({ data: data as any, linkedin: { publishPost: async () => { called = true; } } as any, storage: {} as any, notify: { notify: async () => {} }, clock: () => new Date(date) });
    const result = await service.publishClaimed('p', 'project-1', { content: 'x', media: [], retryCount: 0 });
    assert.equal(result.outcome, 'FAILED'); assert.equal(called, false); assert.equal(failed.code, 'RECONNECT_REQUIRED');
  }
});
