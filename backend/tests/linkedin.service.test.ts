import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { createMockServer } from '../../mock-linkedin/server.js';
import { createLinkedInService, LinkedInError } from '../src/services/linkedin.service.js';
import { encryptToken } from '../src/utils/crypto.js';

const rawToken = 'service-test-token-never-log';
const key = 'a'.repeat(64);
const connection: any = { status: 'ACTIVE', access_token_encrypted: encryptToken(rawToken, key), access_token_expires_at: new Date(Date.now() + 60_000).toISOString() };
const authorUrn = 'urn:li:person:mock-member-001';
let server: any;
let base: string;
let service: any;

async function failNext(options: any) {
  const response = await fetch(`${base}/admin/fail-next`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options) });
  assert.equal(response.status, 201);
}

before(async () => {
  server = createMockServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  server.mockState.tokens.set(rawToken, { sub: 'mock-member-001', scope: 'openid profile w_member_social', expiresAt: Date.now() + 60_000 });
  service = createLinkedInService({
    config: { linkedinApiBase: base, linkedinOAuthBase: base, linkedinApiVersion: '202601', linkedinHttpTimeoutMs: 1000, linkedinClientId: 'mock-client-id', linkedinClientSecret: 'mock-client-secret', tokenEncryptionKey: key } as any,
  });
});

after(async () => { if (server) await new Promise<void>((resolve) => server.close(() => resolve())); });

test('profile requests use an encrypted connection and return OIDC claims', async () => {
  assert.equal(service.getValidAccessToken(connection), rawToken);
  assert.equal((await service.getProfile(connection)).sub, 'mock-member-001');
  assert.throws(() => service.getValidAccessToken({ ...connection, access_token_expires_at: new Date(Date.now() - 1000).toISOString() }), (error: any) => error.code === 'RECONNECT_REQUIRED');
});

test('revokeToken sends the local revoke contract and the token remains absent from result and errors', async () => {
  const revokeToken = 'revoke-test-token';
  server.mockState.tokens.set(revokeToken, { sub: 'mock-member-001', scope: 'openid profile w_member_social', expiresAt: Date.now() + 60_000 });
  const revokeConnection = { ...connection, access_token_encrypted: encryptToken(revokeToken, key) };
  assert.deepEqual(await service.revokeToken(revokeConnection), { status: 200 });
  await assert.rejects(service.getProfile(revokeConnection), (error: any) => error.code === 'LINKEDIN_AUTH' && !error.message.includes(revokeToken));
});

test('image upload, publish, commentary-only update, delete and repeated delete work against mock', async () => {
  const image = await service.uploadImage(connection, { authorUrn, data: Buffer.from('mock image bytes'), altText: 'A mock image', contentType: 'image/png' });
  assert.match(image.imageUrn, /^urn:li:image:/);
  const created = await service.publishPost(connection, { authorUrn, commentary: 'hello | world', image: { id: image.imageUrn, altText: image.altText } });
  assert.match(created.urn, /^urn:li:share:/);
  let posts: any[] = await (await fetch(`${base}/admin/posts`)).json() as any;
  assert.equal(posts.find((post) => post.id === created.urn).commentary, 'hello \\| world');
  assert.equal((await service.updatePost(connection, { postUrn: created.urn, commentary: 'updated @text' })).status, 204);
  posts = await (await fetch(`${base}/admin/posts`)).json() as any;
  assert.equal(posts.find((post) => post.id === created.urn).commentary, 'updated \\@text');
  assert.equal((await service.deletePost(connection, { postUrn: created.urn })).status, 204);
  assert.deepEqual(await service.deletePost(connection, { postUrn: created.urn }), { status: 404, deleted: true });
});

test('REST calls use LinkedIn bearer, version, and Rest.li headers; signed uploads do not receive bearer credentials', async () => {
  const seen: any[] = [];
  const wrappedFetch = async (url: any, options: any) => {
    seen.push({ url: String(url), headers: new Headers(options.headers) });
    return fetch(url, options);
  };
  const capture = createLinkedInService({ config: { linkedinApiBase: base, linkedinApiVersion: '202601', linkedinHttpTimeoutMs: 1000, tokenEncryptionKey: key } as any, fetchImpl: wrappedFetch });
  const image = await capture.uploadImage(connection, { authorUrn, data: Buffer.from('bytes'), contentType: 'image/png' });
  const initialize = seen.find((request) => request.url.includes('/rest/images'));
  const upload = seen.find((request) => request.url.includes('/upload/'));
  assert.equal(initialize.headers.get('authorization'), `Bearer ${rawToken}`);
  assert.equal(initialize.headers.get('linkedin-version'), '202601');
  assert.equal(initialize.headers.get('x-restli-protocol-version'), '2.0.0');
  assert.equal(upload.headers.has('authorization'), false);
  assert.equal(upload.headers.has('linkedin-version'), false);
  assert.match(image.imageUrn, /^urn:li:image:/);
});

for (const [status, code] of [[401, 'LINKEDIN_AUTH'], [403, 'LINKEDIN_SCOPE'], [400, 'LINKEDIN_REJECTED'], [422, 'LINKEDIN_REJECTED'], [429, 'LINKEDIN_RATE_LIMITED'], [500, 'LINKEDIN_UNAVAILABLE']] as const) {
  test(`normalizes HTTP ${status} without exposing provider response details`, async () => {
    await failNext({ status, count: 1, ...(status === 429 ? { retryAfter: 9 } : {}), path: '/v2/userinfo', method: 'GET' });
    await assert.rejects(service.getProfile(connection), (error: any) => {
      assert.ok(error instanceof LinkedInError);
      assert.equal(error.code, code);
      assert.equal(error.retryable, status === 429 || status >= 500);
      assert.equal(error.httpStatus, status);
      assert.equal(error.message.includes(rawToken), false);
      assert.equal(error.message.includes('Injected mock'), false);
      if (status === 429) assert.equal(error.retryAfterSeconds, 9);
      return true;
    });
  });
}

test('network drop retries an idempotent profile read once and never retries a create', async () => {
  await failNext({ count: 1, dropConnection: true, path: '/v2/userinfo', method: 'GET' });
  assert.equal((await service.getProfile(connection)).sub, 'mock-member-001');
  await failNext({ count: 1, dropConnection: true, path: '/rest/posts', method: 'POST' });
  await assert.rejects(service.publishPost(connection, { authorUrn, commentary: 'no retry' }), (error: any) => error.code === 'LINKEDIN_UNAVAILABLE' && error.retryable);
  const posts: any[] = await (await fetch(`${base}/admin/posts`)).json() as any;
  assert.equal(posts.some((post) => post.commentary === 'no retry'), false);
});

test('timeout is normalized without provider details', async () => {
  const slow = createMockServer({ latencyMs: 60 });
  await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', () => resolve()));
  try {
    const timeoutService = createLinkedInService({ config: { linkedinApiBase: `http://127.0.0.1:${(slow.address() as AddressInfo).port}`, linkedinApiVersion: '202601', linkedinHttpTimeoutMs: 10, tokenEncryptionKey: key } as any });
    await assert.rejects(timeoutService.getProfile(connection), (error: any) => error.code === 'LINKEDIN_UNAVAILABLE' && error.retryable && !error.message.includes(rawToken));
  } finally { await new Promise<void>((resolve) => slow.close(() => resolve())); }
});
