import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { AddressInfo } from 'node:net';
import express from 'express';
import { createMockServer } from '../../mock-linkedin/server.js';
import { createConnectionService } from '../src/services/connection.service.js';
import { createConnectionController } from '../src/controllers/connection.controller.js';
import { createLinkedInRouter } from '../src/routes/linkedin.routes.js';
import { decryptToken, hashOAuthState } from '../src/utils/crypto.js';

const KEY = 'a'.repeat(64);
const PROJECT = '00000000-0000-4000-8000-000000000001';
const OTHER_PROJECT = '00000000-0000-4000-8000-000000000002';
const USERS = { admin: '00000000-0000-4000-8000-000000000011', editor: '00000000-0000-4000-8000-000000000012', viewer: '00000000-0000-4000-8000-000000000013' };
let mock: any, appServer: any, base: string, mockBase: string, data: MemoryData, service: any, logs: any[];

class MemoryData {
  states = new Map<string, any>(); connections: any[] = []; linkedPosts: any[] = [];
  callbackAllowed = true;
  clock: () => Date;
  constructor(clock: () => Date) { this.clock = clock; }
  async deleteExpiredOAuthStates() { for (const [hash, state] of this.states) if (Date.parse(state.expiresAt) <= this.clock().getTime()) this.states.delete(hash); }
  async createOAuthState(value: any) { this.states.set(value.stateHash, { ...value, usedAt: null }); }
  async consumeOAuthState(hash: string) {
    const state = this.states.get(hash);
    if (!state) return { status: 'invalid' };
    if (Date.parse(state.expiresAt) <= this.clock().getTime()) return { status: 'expired' };
    if (state.usedAt) return { status: 'invalid' };
    state.usedAt = this.clock().toISOString();
    return { status: 'consumed', project_id: state.projectId, user_id: state.userId };
  }
  async isAllowed(_projectId: string, userId: string) { return (userId === USERS.admin || userId === USERS.editor) && this.callbackAllowed !== false; }
  async getConnection(projectId: string) { return this.connections.find((row) => row.projectId === projectId && row.status === 'ACTIVE') ?? this.connections.find((row) => row.projectId === projectId) ?? null; }
  async getActiveConnectionForDisconnect(projectId: string) { return this.connections.find((row) => row.projectId === projectId && row.status === 'ACTIVE') ?? null; }
  async setExpired(id: string) { const row = this.connections.find((item) => item.id === id); if (row) row.status = 'EXPIRED'; }
  async disconnect(projectId: string) { for (const row of this.connections) if (row.projectId === projectId && row.status === 'ACTIVE') { row.status = 'REVOKED'; row.access_token_encrypted = null; row.refresh_token_encrypted = null; } }
  async connect(input: any) {
    for (const row of this.connections) if (row.projectId === input.projectId && row.status === 'ACTIVE') { row.status = 'REVOKED'; row.access_token_encrypted = null; row.refresh_token_encrypted = null; }
    const row = { id: String(this.connections.length + 1), projectId: input.projectId, linkedin_member_id: input.memberId, author_urn: input.authorUrn, display_name: input.displayName, profile_picture_url: input.pictureUrl, access_token_encrypted: input.accessTokenEncrypted, refresh_token_encrypted: input.refreshTokenEncrypted, access_token_expires_at: input.expiresAt, scopes: input.scopes, status: 'ACTIVE' };
    this.connections.push(row); this.linkedPosts.push({ projectId: input.projectId, connectionId: row.id }); return { id: row.id };
  }
}

const clockRef = { value: new Date('2026-10-17T00:00:00.000Z') };
const clock = () => new Date(clockRef.value);
async function listen(server: any): Promise<string> { await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve())); return `http://127.0.0.1:${(server.address() as AddressInfo).port}`; }
async function setup() {
  data = new MemoryData(clock); logs = [];
  mock = createMockServer({ clientId: 'mock-client-id', clientSecret: 'mock-client-secret', redirectUri: 'http://callback.invalid/api/linkedin/callback' });
  mockBase = await listen(mock);
  const config = { linkedinOAuthBase: mockBase, linkedinApiBase: mockBase, linkedinRedirectUri: 'http://callback.invalid/api/linkedin/callback', linkedinClientId: 'mock-client-id', linkedinClientSecret: 'mock-client-secret', linkedinHttpTimeoutMs: 2000, tokenExpiryWarningDays: 7, frontendUrl: 'http://localhost:3000' };
  service = createConnectionService({ data: data as any, config: config as any, fetchImpl: fetch as any, clock, encryptionKey: KEY, logger: { warn: (line: any) => logs.push(line) } });
  const controller = createConnectionController(service, config as any);
  const roles = new Map([[USERS.admin, 'ADMIN'], [USERS.editor, 'EDITOR'], [USERS.viewer, 'VIEWER']]);
  const projects = { getProject: async (id: string) => [PROJECT, OTHER_PROJECT].includes(id) ? { id } : null, getMembership: async (id: string, userId: string) => (id === PROJECT || id === OTHER_PROJECT && userId === USERS.admin) && roles.has(userId) ? { role: roles.get(userId), linkedin_module_access: userId !== USERS.viewer } : null };
  const app = express(); app.use('/api/linkedin', createLinkedInRouter({ controller, auth: { authenticate: async (req: any) => ({ id: req.headers['x-user-id'] }) } as any, projects: projects as any, sensitiveLimiter: (_req: any, _res: any, next: any) => next() }));
  appServer = app.listen(0, '127.0.0.1'); await new Promise((resolve) => appServer.once('listening', resolve));
  base = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
}
async function close() { await Promise.all([new Promise((resolve) => appServer?.close(resolve)), new Promise((resolve) => mock?.close(resolve))]); }
async function connectStart(user = USERS.admin) {
  const response = await fetch(`${base}/api/linkedin/connect?projectId=${PROJECT}`, { headers: { 'x-user-id': user } });
  const json: any = await response.json(); return { response, json, url: new URL(json.data.authorizationUrl) };
}
async function consent(url: URL, decision = 'allow') { url.searchParams.set('decision', decision); const page = await fetch(url, { redirect: 'manual' }); return new URL(page.headers.get('location')!); }
async function callback(url: URL) { return fetch(`${base}/api/linkedin/callback${url.search}`, { redirect: 'manual' }); }
async function failNext(path: string, method: string, extra = {}) { await fetch(`${mockBase}/admin/fail-next`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 503, count: 1, path, method, ...extra }) }); }

before(setup); after(close);
beforeEach(() => { data.states.clear(); data.connections.length = 0; data.linkedPosts.length = 0; data.callbackAllowed = true; logs.length = 0; clockRef.value = new Date('2026-10-17T00:00:00.000Z'); for (const collection of ['authorizationCodes', 'tokens', 'images', 'uploads', 'posts']) mock.mockState[collection].clear(); mock.mockState.failures.length = 0; });

test('successful consent flow stores only state hash, encrypts token, and omits tokens from API/logs', async () => {
  const { response, url } = await connectStart(); assert.equal(response.status, 200);
  assert.equal(url.searchParams.get('scope'), 'openid profile w_member_social');
  const state = url.searchParams.get('state')!; assert.equal(data.states.has(hashOAuthState(state)), true); assert.equal(data.states.has(state), false);
  assert.match((await callback(await consent(url))).headers.get('location')!, /linkedin=connected/);
  const row = data.connections[0]; const rawToken = decryptToken(row.access_token_encrypted, KEY);
  assert.notEqual(row.access_token_encrypted, rawToken); assert.match(row.access_token_encrypted, /^[^:]+:[^:]+:[^:]+$/);
  const responseBody = await fetch(`${base}/api/linkedin/connection?projectId=${PROJECT}`, { headers: { 'x-user-id': USERS.admin } }).then((r) => r.text());
  assert.match(responseBody, /"status":"ACTIVE"/); assert.match(responseBody, /"expiringSoon":false/); assert.match(responseBody, /"mode":"DEMO"/);
  assert.equal(responseBody.includes(rawToken), false); assert.equal(JSON.stringify(logs).includes(rawToken), false);
});

test('deny, missing query values, forged state, replayed state, and expired state use fixed redirect reasons', async () => {
  const denial = await connectStart(); assert.match((await callback(await consent(denial.url, 'deny'))).headers.get('location')!, /reason=ACCESS_DENIED/);
  const missing = await callback(new URL('http://callback.invalid/api/linkedin/callback')); assert.match(missing.headers.get('location')!, /reason=INVALID_STATE/);
  const startedWithoutCode = await connectStart(); const urlWithoutCode = new URL('http://callback.invalid/api/linkedin/callback'); urlWithoutCode.searchParams.set('state', startedWithoutCode.url.searchParams.get('state')!);
  assert.match((await callback(urlWithoutCode)).headers.get('location')!, /reason=INVALID_STATE/);
  const forged = await callback(new URL('http://callback.invalid/api/linkedin/callback?code=secret-code&state=forged')); assert.match(forged.headers.get('location')!, /reason=INVALID_STATE/);
  const replay = await connectStart(); const callbackUrl = await consent(replay.url); assert.match((await callback(callbackUrl)).headers.get('location')!, /linkedin=connected/); assert.match((await callback(callbackUrl)).headers.get('location')!, /reason=INVALID_STATE/);
  const expired = await connectStart(); clockRef.value = new Date(clockRef.value.getTime() + 601_000);
  const expiredUrl = new URL(`http://callback.invalid/api/linkedin/callback?code=x&state=${encodeURIComponent(expired.url.searchParams.get('state')!)}`);
  assert.match((await callback(expiredUrl)).headers.get('location')!, /reason=EXPIRED_STATE/);
  const revokedAccess = await connectStart(); data.callbackAllowed = false;
  const notAllowed = await callback(await consent(revokedAccess.url)); assert.match(notAllowed.headers.get('location')!, /reason=NOT_ALLOWED/);
});

test('ADMIN and EDITOR may connect; viewer/missing membership are denied and connection state is project-scoped', async () => {
  assert.equal((await connectStart(USERS.editor)).response.status, 200);
  assert.equal((await fetch(`${base}/api/linkedin/connect?projectId=${PROJECT}`, { headers: { 'x-user-id': USERS.viewer } })).status, 403);
  const noUser = await fetch(`${base}/api/linkedin/connect?projectId=${PROJECT}`, { headers: { 'x-user-id': '00000000-0000-4000-8000-000000000099' } }); assert.equal(noUser.status, 403);
  const started = await connectStart(); await callback(await consent(started.url));
  const wrongProject = await fetch(`${base}/api/linkedin/connection?projectId=${OTHER_PROJECT}`, { headers: { 'x-user-id': USERS.admin } }); assert.equal(wrongProject.status, 200); assert.match(await wrongProject.text(), /NOT_CONNECTED/);
  const wrongProjectDelete = await fetch(`${base}/api/linkedin/connection?projectId=${OTHER_PROJECT}`, { method: 'DELETE', headers: { 'x-user-id': USERS.admin } }); assert.equal(wrongProjectDelete.status, 200);
  assert.equal(data.connections.some((row) => row.projectId === PROJECT && row.status === 'ACTIVE'), true);
  const viewerDelete = await fetch(`${base}/api/linkedin/connection?projectId=${PROJECT}`, { method: 'DELETE', headers: { 'x-user-id': USERS.viewer } }); assert.equal(viewerDelete.status, 403);
});

test('exchange and profile provider failures redirect safely without replacing existing connection', async () => {
  let flow = await connectStart(); await failNext('/oauth/v2/accessToken', 'POST');
  assert.match((await callback(await consent(flow.url))).headers.get('location')!, /reason=EXCHANGE_FAILED/);
  assert.equal(data.connections.filter((row) => row.status === 'ACTIVE').length, 0);
  flow = await connectStart(); await failNext('/v2/userinfo', 'GET');
  assert.match((await callback(await consent(flow.url))).headers.get('location')!, /reason=PROFILE_FAILED/);
  assert.equal(data.connections.length, 0); assert.equal(JSON.stringify(logs).includes('Injected mock'), false);
});

test('reconnect replaces active connection, disconnect revokes and wipes token columns', async () => {
  let flow = await connectStart(); await callback(await consent(flow.url));
  const old = data.connections[0]; const oldId = old.id;
  flow = await connectStart(USERS.editor); await callback(await consent(flow.url));
  const active = data.connections.filter((row) => row.status === 'ACTIVE'); assert.equal(active.length, 1); assert.notEqual(active[0].id, oldId);
  assert.equal(old.status, 'REVOKED'); assert.equal(old.access_token_encrypted, null); assert.equal(data.linkedPosts.at(-1).connectionId, active[0].id);
  const raw = decryptToken(active[0].access_token_encrypted, KEY);
  const response = await fetch(`${base}/api/linkedin/connection?projectId=${PROJECT}`, { method: 'DELETE', headers: { 'x-user-id': USERS.admin } });
  assert.deepEqual(((await response.json()) as any).data, { status: 'NOT_CONNECTED' }); assert.equal(active[0].status, 'REVOKED');
  assert.equal(active[0].access_token_encrypted, null); assert.equal(active[0].refresh_token_encrypted, null);
  assert.equal(JSON.stringify(logs).includes(raw), false);
});

test('revoke provider failure still wipes stored tokens and logs only sanitized metadata', async () => {
  const flow = await connectStart(); await callback(await consent(flow.url));
  const row = data.connections.find((item) => item.status === 'ACTIVE'); const raw = decryptToken(row.access_token_encrypted, KEY);
  await failNext('/oauth/v2/revoke', 'POST'); await service.disconnect(PROJECT);
  assert.equal(row.access_token_encrypted, null); assert.equal(JSON.stringify(logs).includes(raw), false);
  assert.equal(JSON.stringify(logs).includes('mock-client-secret'), false);
});

test('connection read marks expired tokens and computes the warning fields in UTC', async () => {
  const flow = await connectStart(); await callback(await consent(flow.url));
  clockRef.value = new Date(clockRef.value.getTime() + 54 * 24 * 60 * 60 * 1000);
  const warning = await service.get(PROJECT); assert.equal(warning.status, 'ACTIVE'); assert.equal(warning.daysUntilExpiry, 6); assert.equal(warning.expiringSoon, true);
  clockRef.value = new Date(clockRef.value.getTime() + 61 * 24 * 60 * 60 * 1000);
  const status = await service.get(PROJECT); assert.equal(status.status, 'EXPIRED'); assert.equal(status.expiringSoon, false);
  assert.equal(data.connections.find((row) => row.status === 'EXPIRED').status, 'EXPIRED');
});
