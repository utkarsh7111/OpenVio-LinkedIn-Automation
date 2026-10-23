import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockServer, type MockServerOptions } from '../server.ts';

const clientId = 'test-client';
const clientSecret = 'test-secret';
const redirectUri = 'http://localhost:4100/callback';
const scope = 'openid profile w_member_social';

async function withServer(callback: (base: string) => Promise<void>, options: MockServerOptions = {}): Promise<void> {
  const server = createMockServer({ clientId, clientSecret, redirectUri, ...options });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mock server did not bind to a TCP port');
  const base = `http://127.0.0.1:${address.port}`;
  try { await callback(base); } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}

async function consent(base: string, decision: 'allow' | 'deny' = 'allow'): Promise<URL> {
  const url = new URL('/oauth/v2/authorization', base);
  url.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state: 'random-state-123', scope }).toString();
  const page = await fetch(url);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Allow/);
  assert.match(html, /Deny/);
  url.searchParams.set('decision', decision);
  const decisionResponse = await fetch(url, { redirect: 'manual' });
  assert.equal(decisionResponse.status, 302);
  const location = decisionResponse.headers.get('location');
  assert.ok(location);
  return new URL(location);
}

async function accessToken(base: string): Promise<{ token: string; code: string }> {
  const callback = await consent(base);
  const code = callback.searchParams.get('code');
  assert.ok(code);
  const response = await fetch(`${base}/oauth/v2/accessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json() as { access_token: string };
  return { token: payload.access_token, code };
}

const restHeaders = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}`, 'Linkedin-Version': '202601', 'X-Restli-Protocol-Version': '2.0.0', 'Content-Type': 'application/json' });

test('health, authorization allow/deny consent, callback parameters, and OAuth request validation', async () => {
  await withServer(async (base) => {
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { status: 'ok' });
    const denied = await consent(base, 'deny');
    assert.equal(denied.searchParams.get('error'), 'user_cancelled_authorize');
    assert.equal(denied.searchParams.get('state'), 'random-state-123');
    const invalid = await fetch(`${base}/oauth/v2/authorization?response_type=token`, { redirect: 'manual' });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, 'invalid_request');
    const wrongRedirect = new URL('/oauth/v2/authorization', base);
    wrongRedirect.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: 'http://evil.example/callback', state: 's', scope }).toString();
    assert.equal((await fetch(wrongRedirect)).status, 400);
  });
});

test('authorization-code exchange validates fields and credentials, is single use, and returns OAuth-shaped token data', async () => {
  await withServer(async (base) => {
    const { token, code } = await accessToken(base);
    assert.ok(token);
    const malformed = await fetch(`${base}/oauth/v2/accessToken`, { method: 'POST', body: 'code=x' });
    assert.equal(malformed.status, 415);
    const badSecret = await fetch(`${base}/oauth/v2/accessToken`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: 'wrong' }) });
    assert.equal(badSecret.status, 401);
    const badClient = await fetch(`${base}/oauth/v2/accessToken`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: 'wrong-client', client_secret: clientSecret }) });
    assert.equal(badClient.status, 401);
    const badRedirect = await fetch(`${base}/oauth/v2/accessToken`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: 'http://localhost:4100/other', client_id: clientId, client_secret: clientSecret }) });
    assert.equal(badRedirect.status, 400);
    const replay = await fetch(`${base}/oauth/v2/accessToken`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }) });
    assert.equal(replay.status, 400);
    assert.equal((await replay.json()).error, 'invalid_grant');
    const wrongCode = await fetch(`${base}/oauth/v2/accessToken`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: 'wrong', redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }) });
    assert.equal(wrongCode.status, 400);
  });
});

test('OIDC userinfo requires a valid bearer token; revoke invalidates it', async () => {
  await withServer(async (base) => {
    const { token } = await accessToken(base);
    const missing = await fetch(`${base}/v2/userinfo`);
    assert.equal(missing.status, 401);
    const profileResponse = await fetch(`${base}/v2/userinfo`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(profileResponse.status, 200);
    const profile = await profileResponse.json();
    assert.equal(profile.sub, 'mock-member-001');
    assert.equal(profile.name, 'OpenVio Mock Member');
    assert.ok(profile.picture);
    assert.equal('access_token' in profile, false);
    const badRevoke = await fetch(`${base}/oauth/v2/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: 'bad', token }) });
    assert.equal(badRevoke.status, 400);
    const revoked = await fetch(`${base}/oauth/v2/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, token }) });
    assert.deepEqual(await revoked.json(), { revoked: true });
    assert.equal((await fetch(`${base}/v2/userinfo`, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
  });
});

test('Images API initializes upload, returns upload URL/image URN, accepts PUT bytes, and validates headers/body', async () => {
  await withServer(async (base) => {
    const { token } = await accessToken(base);
    const body = { initializeUploadRequest: { owner: 'urn:li:person:mock-member-001' } };
    const unauthorized = await fetch(`${base}/rest/images?action=initializeUpload`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0', 'Linkedin-Version': '202601' }, body: JSON.stringify(body) });
    assert.equal(unauthorized.status, 401);
    const headers = restHeaders(token);
    const noVersion = await fetch(`${base}/rest/images?action=initializeUpload`, { method: 'POST', headers: { ...headers, 'X-Restli-Protocol-Version': '' }, body: JSON.stringify(body) });
    assert.equal(noVersion.status, 400);
    const invalidOwner = await fetch(`${base}/rest/images?action=initializeUpload`, { method: 'POST', headers, body: JSON.stringify({ initializeUploadRequest: { owner: 'urn:li:organization:12' } }) });
    assert.equal(invalidOwner.status, 400);
    const initialized = await fetch(`${base}/rest/images?action=initializeUpload`, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(initialized.status, 200);
    const payload = await initialized.json();
    assert.match(payload.value.image, /^urn:li:image:/);
    assert.ok(payload.value.uploadUrlExpiresAt);
    const uploaded = await fetch(payload.value.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: Buffer.from([1, 2, 3]) });
    assert.equal(uploaded.status, 201);
    const postBody = {
      author: 'urn:li:person:mock-member-001', commentary: 'Image post', visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { media: { id: payload.value.image, altText: 'A local mock image' } },
      lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
    };
    assert.equal((await fetch(`${base}/rest/posts`, { method: 'POST', headers, body: JSON.stringify(postBody) })).status, 201);
    assert.equal((await fetch(`${base}/upload/not-a-valid-upload-id`, { method: 'PUT', body: 'image' })).status, 404);
    assert.equal((await fetch(`${base}/rest/images?action=unknown`, { method: 'POST', headers, body: JSON.stringify(body) })).status, 400);
  });
});

test('Posts API creates with LinkedIn headers/body, updates commentary via PARTIAL_UPDATE, deletes, and supports admin inspect/reset', async () => {
  await withServer(async (base) => {
    const { token } = await accessToken(base);
    const headers = restHeaders(token);
    const body = {
      author: 'urn:li:person:mock-member-001', commentary: 'First post', visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
    };
    assert.equal((await fetch(`${base}/rest/posts`, { method: 'POST', headers: { ...headers, 'X-Restli-Protocol-Version': '' }, body: JSON.stringify(body) })).status, 400);
    assert.equal((await fetch(`${base}/rest/posts`, { method: 'POST', headers: { ...headers, 'Linkedin-Version': 'bad' }, body: JSON.stringify(body) })).status, 400);
    assert.equal((await fetch(`${base}/rest/posts`, { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: JSON.stringify(body) })).status, 415);
    assert.equal((await fetch(`${base}/rest/posts`, { method: 'POST', headers, body: JSON.stringify({ ...body, lifecycleState: 'DRAFT' }) })).status, 400);
    const created = await fetch(`${base}/rest/posts`, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(created.status, 201);
    const urn = created.headers.get('x-restli-id');
    assert.ok(urn);
    assert.match(urn, /^urn:li:share:/);
    assert.equal((await (await fetch(`${base}/admin/posts`)).json()).length, 1);
    const encodedUrn = encodeURIComponent(urn);
    assert.equal((await fetch(`${base}/rest/posts/${encodedUrn}`, { method: 'POST', headers, body: JSON.stringify({ patch: { $set: { commentary: 'Updated post' } } }) })).status, 400);
    const updated = await fetch(`${base}/rest/posts/${encodedUrn}`, { method: 'POST', headers: { ...headers, 'X-RestLi-Method': 'PARTIAL_UPDATE' }, body: JSON.stringify({ patch: { $set: { commentary: 'Updated post' } } }) });
    assert.equal(updated.status, 204);
    assert.equal((await (await fetch(`${base}/admin/posts`)).json())[0].commentary, 'Updated post');
    const invalidPatch = await fetch(`${base}/rest/posts/${encodedUrn}`, { method: 'POST', headers: { ...headers, 'X-RestLi-Method': 'PARTIAL_UPDATE' }, body: JSON.stringify({ patch: { $set: { author: 'urn:li:person:evil' } } }) });
    assert.equal(invalidPatch.status, 400);
    assert.equal((await fetch(`${base}/rest/posts/${encodedUrn}`, { method: 'DELETE', headers })).status, 204);
    assert.equal((await fetch(`${base}/rest/posts/${encodedUrn}`, { method: 'DELETE', headers })).status, 404);
    assert.deepEqual(await (await fetch(`${base}/admin/posts`)).json(), []);
    assert.deepEqual(await (await fetch(`${base}/admin/reset`, { method: 'POST' })).json(), { reset: true });
  });
});

test('fail-next injects status, Retry-After, exact count, and connection drops', async () => {
  await withServer(async (base) => {
    const params = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state: 's', scope });
    const target = `${base}/oauth/v2/authorization?${params}`;
    const queued = await fetch(`${base}/admin/fail-next`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 429, count: 2, retryAfter: 7, path: '/oauth/v2/authorization', method: 'GET' }) });
    assert.equal(queued.status, 201);
    for (let i = 0; i < 2; i += 1) {
      const failed = await fetch(target);
      assert.equal(failed.status, 429);
      assert.equal(failed.headers.get('retry-after'), '7');
    }
    assert.equal((await fetch(target)).status, 200);
    const invalidFailure = await fetch(`${base}/admin/fail-next`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 200, count: 1 }) });
    assert.equal(invalidFailure.status, 400);
    await fetch(`${base}/admin/fail-next`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 500, count: 1, path: '/oauth/v2/authorization' }) });
    assert.equal((await fetch(target)).status, 500);
    await fetch(`${base}/admin/fail-next`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: 1, dropConnection: true, path: '/oauth/v2/authorization' }) });
    await assert.rejects(() => fetch(target));
  });
});

test('latency and configured connection-drop options are active', async () => {
  await withServer(async (base) => {
    const started = Date.now();
    await fetch(`${base}/oauth/v2/authorization`);
    assert.ok(Date.now() - started >= 20);
  }, { latencyMs: 25 });
  await withServer(async (base) => {
    await assert.rejects(() => fetch(`${base}/oauth/v2/authorization`));
  }, { dropConnections: true });
});
