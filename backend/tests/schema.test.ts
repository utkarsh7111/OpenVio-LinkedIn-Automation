import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

// Runs only when TEST_DATABASE_URL points at a migrated, disposable database.
const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'set TEST_DATABASE_URL to run schema tests' };

async function inRollback(fn: (client: pg.Client, pid: string) => Promise<void>) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`INSERT INTO projects(name) VALUES ('t') RETURNING id`);
    await fn(client, rows[0].id);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}
const rejects = async (client: pg.Client, sql: string, params: any[], pattern: RegExp) => {
  await client.query('SAVEPOINT s');
  await assert.rejects(() => client.query(sql, params), pattern);
  await client.query('ROLLBACK TO SAVEPOINT s');
};
const post = (extra = '') => `INSERT INTO linkedin_posts(project_id, content${extra ? ', ' + extra.split('|')[0] : ''}) VALUES ($1, $2${extra ? ', ' + extra.split('|')[1] : ''})`;

test('post content must be 1-3000 characters and not blank', opts, async () => {
  await inRollback(async (c, pid) => {
    await c.query(post(), [pid, 'ok']);
    await rejects(c, post(), [pid, '   '], /check/);
    await rejects(c, post(), [pid, 'x'.repeat(3001)], /check/);
  });
});

test('SCHEDULED needs scheduled_at and PUBLISHED needs a URN', opts, async () => {
  await inRollback(async (c, pid) => {
    await rejects(c, post("status|'SCHEDULED'"), [pid, 'hi'], /check/);
    await rejects(c, post("status|'PUBLISHED'"), [pid, 'hi'], /check/);
    await rejects(c, post("status|'BOGUS'"), [pid, 'hi'], /check/);
  });
});

test('a LinkedIn post URN can be stored only once', opts, async () => {
  await inRollback(async (c, pid) => {
    const sql = `INSERT INTO linkedin_posts(project_id, content, status, linkedin_post_urn) VALUES ($1, 'a', 'PUBLISHED', 'urn:li:share:1')`;
    await c.query(sql, [pid]);
    await rejects(c, sql, [pid], /duplicate key/);
  });
});

test('only one ACTIVE connection per project', opts, async () => {
  await inRollback(async (c, pid) => {
    const sql = `INSERT INTO linkedin_connections(project_id, linkedin_member_id, author_urn, access_token_encrypted) VALUES ($1, $2, 'urn:li:person:x', 'cipher')`;
    await c.query(sql, [pid, 'm1']);
    await rejects(c, sql, [pid, 'm2'], /duplicate key/);
  });
});

test('updated_at is maintained by trigger', opts, async () => {
  await inRollback(async (c, pid) => {
    const { rows } = await c.query(`INSERT INTO linkedin_posts(project_id, content, updated_at) VALUES ($1, 'a', now() - interval '1 day') RETURNING id`, [pid]);
    const before = (await c.query('SELECT updated_at FROM linkedin_posts WHERE id = $1', [rows[0].id])).rows[0].updated_at;
    await c.query(`UPDATE linkedin_posts SET content = 'b' WHERE id = $1`, [rows[0].id]);
    const after = (await c.query('SELECT updated_at FROM linkedin_posts WHERE id = $1', [rows[0].id])).rows[0].updated_at;
    assert.ok(after > before);
  });
});

test('seeded viewer has no LinkedIn module access', opts, async () => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(`SELECT role, linkedin_module_access FROM project_members ORDER BY role`);
    if (!rows.length) return; // not seeded
    assert.equal(rows.find((r) => r.role === 'VIEWER')?.linkedin_module_access, false);
    assert.equal(rows.find((r) => r.role === 'ADMIN')?.linkedin_module_access, true);
  } finally { await client.end(); }
});

test('migration 002 adds bounded post events, cascades, idempotency uniqueness, and history index', { skip: url ? false : 'set TEST_DATABASE_URL to run schema tests' }, async (t) => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows: tables } = await client.query("SELECT to_regclass('linkedin_post_events') AS events");
    if (!tables[0].events) return t.skip('apply migrations before schema tests');
    await client.query('BEGIN');
    const { rows: projectRows } = await client.query("INSERT INTO projects(name) VALUES ('migration-002') RETURNING id");
    const projectId = projectRows[0].id;
    const { rows: otherProjectRows } = await client.query("INSERT INTO projects(name) VALUES ('migration-002-other') RETURNING id");
    const otherProjectId = otherProjectRows[0].id;
    const { rows: userRows } = await client.query("INSERT INTO dev_users(name, role) VALUES ('event-actor', 'ADMIN') RETURNING id");
    const userId = userRows[0].id;
    const { rows: postRows } = await client.query("INSERT INTO linkedin_posts(project_id, content, idempotency_key) VALUES ($1, 'post', 'once') RETURNING id", [projectId]);
    const postId = postRows[0].id;
    await client.query("INSERT INTO linkedin_posts(project_id, content, idempotency_key) VALUES ($1, 'another', NULL)", [projectId]);
    await client.query("INSERT INTO linkedin_posts(project_id, content, idempotency_key) VALUES ($1, 'other project', 'once')", [otherProjectId]);
    await rejects(client, "INSERT INTO linkedin_posts(project_id, content, idempotency_key) VALUES ($1, 'duplicate', 'once')", [projectId], /duplicate key/);
    await client.query("INSERT INTO linkedin_post_events(post_id, project_id, from_status, to_status, actor_user_id, detail) VALUES ($1, $2, 'DRAFT', 'SCHEDULED', $3, 'scheduled')", [postId, projectId, userId]);
    await rejects(client, "INSERT INTO linkedin_post_events(post_id, project_id, from_status, to_status, detail) VALUES ($1, $2, 'DRAFT', 'FAILED', $3)", [postId, projectId, 'x'.repeat(501)], /check/);
    const { rows: indexes } = await client.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('linkedin_posts', 'linkedin_post_events')");
    const { rows: columns } = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'linkedin_posts'");
    assert.ok(columns.some((column) => column.column_name === 'idempotency_key'));
    assert.ok(columns.some((column) => column.column_name === 'last_error_at'));
    assert.ok(indexes.some((index) => index.indexname === 'linkedin_post_events_post_created_idx'));
    assert.ok(indexes.some((index) => index.indexname === 'linkedin_posts_project_idempotency_unique_idx' && index.indexdef.includes('UNIQUE')));
    assert.ok(indexes.some((index) => index.indexname === 'linkedin_posts_project_status_created_idx' && index.indexdef.includes('created_at DESC')));
    await client.query('DELETE FROM linkedin_posts WHERE id = $1', [postId]);
    const { rows: eventRows } = await client.query('SELECT id FROM linkedin_post_events WHERE post_id = $1', [postId]);
    assert.equal(eventRows.length, 0, 'post deletion cascades to its event history');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
});
