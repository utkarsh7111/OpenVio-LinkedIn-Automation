import assert from 'node:assert/strict';
import test from 'node:test';
import { createConnectionData } from '../src/db/connection.data.js';

test('OAuth data stores only the hash and consumes in one conditional update', async () => {
  const calls: Array<{ sql: string; params?: any[] }> = [];
  const database = { query: async (sql: string, params?: any[]) => { calls.push({ sql, params }); if (sql.startsWith('UPDATE oauth_states')) return { rows: [{ user_id: 'user', project_id: 'project' }] }; return { rows: [] }; } };
  const data = createConnectionData(database as any);
  await data.createOAuthState({ stateHash: 'hashed-value', state: 'raw-state-must-not-be-used', userId: 'user', projectId: 'project', expiresAt: '2026-10-17T00:10:00.000Z' } as any);
  const stored = calls[0]; assert.match(stored.sql, /state_hash/); assert.doesNotMatch(stored.sql, /\bstate\b(?!_hash)/); assert.deepEqual(stored.params, ['hashed-value', 'user', 'project', '2026-10-17T00:10:00.000Z']);
  assert.deepEqual(await data.consumeOAuthState('hashed-value'), { status: 'consumed', user_id: 'user', project_id: 'project' });
  const consume = calls[1];
  assert.match(consume.sql, /UPDATE oauth_states SET used_at = now\(\) WHERE state_hash = \$1 AND used_at IS NULL AND expires_at > now\(\) RETURNING/);
  assert.deepEqual(consume.params, ['hashed-value']);
});

test('connection reads never select encrypted token columns and expiry updates stay scoped', async () => {
  const calls: Array<{ sql: string; params?: any[] }> = [];
  const data = createConnectionData({ query: async (sql: string, params?: any[]) => { calls.push({ sql, params }); return { rows: [{ id: 'connection' }] }; } } as any);
  await data.getConnection('project');
  assert.match(calls[0].sql, /WHERE project_id = \$1/); assert.equal(calls[0].sql.includes('access_token_encrypted'), false);
  await data.setExpired('connection');
  assert.deepEqual(calls[1].params, ['connection']); assert.match(calls[1].sql, /status = 'ACTIVE'/);
});

test('connect is transactional, wipes the old row, inserts new encrypted values, and re-links project posts', async () => {
  const queries: Array<{ sql: string; params?: any[] }> = [];
  const client = { query: async (sql: string, params: any[] = []) => { queries.push({ sql, params }); if (sql.includes('INSERT INTO linkedin_connections')) return { rows: [{ id: 'new-connection' }], rowCount: 1 }; if (sql.includes('RETURNING id')) return { rows: [], rowCount: 1 }; return { rows: [], rowCount: 1 }; }, release() { queries.push({ sql: 'RELEASE' }); } };
  const data = createConnectionData({ connect: async () => client, query: async () => ({ rows: [] }) } as any);
  await data.connect({ projectId: 'project', userId: 'user', memberId: 'member', authorUrn: 'urn:li:person:member', displayName: 'Member', pictureUrl: null, accessTokenEncrypted: 'iv:tag:cipher', refreshTokenEncrypted: null, expiresAt: '2026-12-16T00:00:00.000Z', refreshExpiresAt: null, scopes: ['openid'] });
  assert.equal(queries[0].sql, 'BEGIN');
  assert.match(queries[1].sql, /status = 'REVOKED'.*access_token_encrypted = NULL/s);
  const insert = queries[2]; assert.match(insert.sql, /INSERT INTO linkedin_connections/); assert.ok(insert.params?.includes('iv:tag:cipher'));
  assert.match(queries[3].sql, /UPDATE linkedin_posts SET connection_id = \$2 WHERE project_id = \$1/);
  assert.equal(queries[4].sql, 'COMMIT');
});

test('disconnect wipes both token columns and revokes only the selected project’s active connection', async () => {
  let call: { sql: string; params?: any[] } | undefined;
  const data = createConnectionData({ query: async (sql: string, params?: any[]) => { call = { sql, params }; return { rows: [] }; } } as any);
  await data.disconnect('project');
  assert.match(call!.sql, /status = 'REVOKED'/); assert.match(call!.sql, /access_token_encrypted = NULL/); assert.match(call!.sql, /refresh_token_encrypted = NULL/); assert.match(call!.sql, /WHERE project_id = \$1 AND status = 'ACTIVE'/); assert.deepEqual(call!.params, ['project']);
});
