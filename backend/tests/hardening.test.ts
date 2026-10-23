import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from '../src/config/env.js';
import { createAuthAdapter } from '../src/adapters/auth.js';
import { createLinkedInService } from '../src/services/linkedin.service.js';
import { createConnectionService } from '../src/services/connection.service.js';
import { encryptToken } from '../src/utils/crypto.js';

const KEY = 'd'.repeat(64);
const USER = '00000000-0000-4000-8000-000000000011';

test('mock-mode development gets a random temporary encryption key instead of failing OAuth', () => {
  const a = loadEnv({ NODE_ENV: 'test' });
  const b = loadEnv({ NODE_ENV: 'test' });
  assert.match(a.tokenEncryptionKey, /^[0-9a-f]{64}$/);
  assert.equal(a.tokenKeyEphemeral, true);
  assert.notEqual(a.tokenEncryptionKey, b.tokenEncryptionKey);
  assert.equal(loadEnv({ NODE_ENV: 'test', TOKEN_ENCRYPTION_KEY: KEY }).tokenKeyEphemeral, false);
});

test('dev identity is off unless explicitly enabled, and never on in production', () => {
  assert.equal(loadEnv({ NODE_ENV: 'development' }).devAuthEnabled, false);
  assert.equal(loadEnv({ NODE_ENV: 'development', DEV_AUTH_ENABLED: 'true' }).devAuthEnabled, true);
  const prod = { NODE_ENV: 'production', DEV_AUTH_ENABLED: 'true', LINKEDIN_MODE: 'live', LINKEDIN_CLIENT_ID: 'i', LINKEDIN_CLIENT_SECRET: 's', LINKEDIN_REDIRECT_URI: 'https://a.example/cb', TOKEN_ENCRYPTION_KEY: KEY, DATABASE_URL: 'postgresql://u:p@db/x', FRONTEND_URL: 'https://app.example', PUBLIC_API_BASE_URL: 'https://a.example' };
  assert.equal(loadEnv(prod).devAuthEnabled, false);
});

test('a disabled dev adapter ignores a valid x-dev-user-id header and never queries the database', async () => {
  let queried = false;
  const adapter = createAuthAdapter({ isProduction: false, devAuthEnabled: false, database: { query: async () => { queried = true; return { rows: [{ id: USER }] }; } } as any });
  assert.equal(await adapter.authenticate({ get: () => USER, headers: { 'x-dev-user-id': USER } } as any), null);
  assert.equal(queried, false);
});

function uploadService(config: any, uploadUrl: string) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchImpl = async (url: any, options: any) => {
    calls.push({ url: String(url), method: options.method });
    if (String(url).includes('initializeUpload')) return new Response(JSON.stringify({ value: { uploadUrl, image: 'urn:li:image:abc123' } }), { status: 200 });
    return new Response(null, { status: 201 });
  };
  const service = createLinkedInService({ config: { linkedinApiVersion: '202601', linkedinHttpTimeoutMs: 1000, tokenEncryptionKey: KEY, ...config }, fetchImpl: fetchImpl as any });
  const connection = { status: 'ACTIVE' as const, access_token_expires_at: new Date(Date.now() + 3_600_000).toISOString(), access_token_encrypted: encryptToken('tok', KEY) };
  return { calls, upload: () => service.uploadImage(connection, { authorUrn: 'urn:li:person:abc', data: Buffer.from('x'), contentType: 'image/png' }) };
}

test('live mode refuses provider upload URLs outside LinkedIn (SSRF defense)', async () => {
  for (const bad of ['http://169.254.169.254/latest/meta-data', 'https://evil.example.com/upload', 'https://linkedin.com.evil.example/x', 'http://www.linkedin.com/upload', 'not a url']) {
    const { calls, upload } = uploadService({ linkedinMode: 'live', linkedinApiBase: 'https://api.linkedin.com' }, bad);
    await assert.rejects(upload, (error: any) => error.code === 'LINKEDIN_UNAVAILABLE', bad);
    assert.equal(calls.some((call) => call.method === 'PUT'), false, `no PUT for ${bad}`);
  }
  const ok = uploadService({ linkedinMode: 'live', linkedinApiBase: 'https://api.linkedin.com' }, 'https://www.linkedin.com/dms-uploads/abc');
  assert.equal((await ok.upload()).imageUrn, 'urn:li:image:abc123');
});

test('mock mode only uploads to the configured mock origin', async () => {
  const good = uploadService({ linkedinMode: 'mock', linkedinApiBase: 'http://127.0.0.1:4100' }, 'http://127.0.0.1:4100/upload/1');
  assert.equal((await good.upload()).imageUrn, 'urn:li:image:abc123');
  const bad = uploadService({ linkedinMode: 'mock', linkedinApiBase: 'http://127.0.0.1:4100' }, 'http://10.0.0.5/upload/1');
  await assert.rejects(bad.upload, (error: any) => error.code === 'LINKEDIN_UNAVAILABLE');
});

async function runCallback(config: any, profile: any) {
  let saved: any;
  const data = {
    consumeOAuthState: async () => ({ status: 'consumed', user_id: USER, project_id: '00000000-0000-4000-8000-000000000001' }),
    connect: async (input: any) => { saved = input; return { id: 'c1' }; },
  };
  const fetchImpl = async (url: any) => String(url).includes('accessToken')
    ? new Response(JSON.stringify({ access_token: 'a', expires_in: 3600 }), { status: 200 })
    : new Response(JSON.stringify(profile), { status: 200 });
  const service = createConnectionService({ data: data as any, fetchImpl: fetchImpl as any, encryptionKey: KEY, config: { linkedinApiBase: 'https://api.linkedin.com', linkedinOAuthBase: 'https://www.linkedin.com', linkedinHttpTimeoutMs: 1000, linkedinRedirectUri: 'https://a.example/cb', linkedinClientId: 'i', linkedinClientSecret: 's', ...config } as any });
  const result = await service.callback({ code: 'c', state: 's' });
  return { result, saved };
}

test('profile pictures and names from LinkedIn are sanitized before storage', async () => {
  const live = { linkedinMode: 'live' };
  for (const picture of ['javascript:alert(1)', 'http://media.licdn.com/a.png', 'https://evil.example.com/a.png', 'data:image/png;base64,AAAA']) {
    const { result, saved } = await runCallback(live, { sub: 'abc', name: 'Ada', picture });
    assert.equal(result.connected, true);
    assert.equal(saved.pictureUrl, null, picture);
  }
  const good = await runCallback(live, { sub: 'abc', name: 'Ada\u0000\u0007 Lovelace', picture: 'https://media.licdn.com/dms/image/a.jpg' });
  assert.equal(good.saved.pictureUrl, 'https://media.licdn.com/dms/image/a.jpg');
  assert.equal(good.saved.displayName, 'Ada Lovelace');
  assert.equal((await runCallback(live, { sub: 'abc', name: 'x'.repeat(500) })).saved.displayName.length, 200);
});
