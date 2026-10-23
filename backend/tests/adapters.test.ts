import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthAdapter } from '../src/adapters/auth.js';
import { createAiAdapter } from '../src/adapters/ai.js';
import { createSchedulerAdapter } from '../src/adapters/scheduler.js';
import { createStorageAdapter } from '../src/adapters/storage.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('auth adapter requires a real verifier in production and only looks up dev identities by ID', async () => {
  assert.throws(() => createAuthAdapter({ isProduction: true } as any), /identity verifier/);
  let called: { sql: string; params: any[] } | undefined;
  const adapter = createAuthAdapter({ isProduction: false, devAuthEnabled: true, database: { query: async (sql: string, params: any[]) => { called = { sql, params }; return { rows: [{ id: params[0] }] }; } } as any });
  const userId = '11111111-1111-4111-8111-111111111111';
  assert.equal((await adapter.authenticate({ headers: { 'x-dev-user-id': userId } } as any))?.id, userId);
  assert.deepEqual(called!.params, [userId]);
  assert.equal(await adapter.authenticate({ headers: { 'x-dev-user-id': 'ADMIN' } } as any), null);
});

test('AI mock is deterministic; OpenAI request contains only topic, tone, and length', async () => {
  const mock = createAiAdapter({ provider: 'mock' });
  assert.deepEqual(await mock.generate({ topic: 'A topic', tone: 'friendly', length: 'short' }), await mock.generate({ topic: 'A topic', tone: 'friendly', length: 'short' }));
  let sent: any;
  const real = createAiAdapter({ provider: 'openai', apiKey: 'test-key', fetchImpl: async (_url: any, init: any) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Generated post.' } }] }) } as any;
  } } as any);
  assert.equal((await real.generate({ topic: 'topic only', tone: 'professional', length: 'medium' })).text, 'Generated post.');
  assert.match(sent.messages[1].content, /topic only/);
  assert.doesNotMatch(JSON.stringify(sent), /post data|token|identity/);
});

test('AI enhancer applies supported actions in demo mode and sends only draft content to the real provider', async () => {
  const mock = createAiAdapter({ provider: 'mock' });
  const demo = await mock.enhance({ content: "i can't share updates yet", action: 'professional' });
  assert.equal(demo.mock, true);
  assert.match(demo.text, /cannot/);
  assert.ok(demo.text.length <= 3000);
  await assert.rejects(() => mock.enhance({ content: 'text', action: 'publish' as any }), /Unsupported AI enhancement action/);

  let sent: any;
  const real = createAiAdapter({ provider: 'openai', apiKey: 'test-key', fetchImpl: async (_url: any, init: any) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'A clearer, professional draft.' } }] }) } as any;
  } } as any);
  const result = await real.enhance({ content: 'original user draft', action: 'professional' });
  assert.equal(result.text, 'A clearer, professional draft.');
  assert.equal(result.mock, false);
  assert.match(sent.messages[0].content, /Preserve the author/);
  assert.match(sent.messages[1].content, /original user draft/);
  assert.doesNotMatch(JSON.stringify(sent), /test-key|projectId|access_token|client_secret/i);
});

test('storage accepts only detected image types, enforces size, stores random names, and blocks traversal', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openvio-storage-'));
  try {
    const storage = createStorageAdapter({ directory, baseUrl: 'https://api.example.test', maxBytes: 64 });
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.writeUInt32BE(1, 16); png.writeUInt32BE(1, 20);
    const saved = await storage.saveImage(png);
    assert.match(saved.url, /^https:\/\/api\.example\.test\/uploads\/[0-9a-f-]{36}\.png$/);
    assert.equal(saved.type, 'image/png');
    assert.equal(storage.validateMediaUrl(saved.url), true);
    assert.equal(storage.validateMediaUrl('https://other.example/uploads/file.png'), false);
    assert.equal((await storage.readUpload(path.basename(saved.url)))?.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(await storage.readUpload('../../secret.png'), null);
    await assert.rejects(() => storage.saveImage(Buffer.from('not an image')), /Only JPEG/);
    await assert.rejects(() => storage.saveImage(Buffer.alloc(65)), /size limit/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('scheduler adapter does not overlap runs and stops its interval', async () => {
  let calls = 0;
  let release!: () => void;
  const adapter = createSchedulerAdapter({ processDuePosts: async () => { calls += 1; await new Promise<void>((resolve) => { release = resolve; }); }, intervalSeconds: 1 });
  const first = adapter.runOnce();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await adapter.runOnce(), false);
  assert.equal(calls, 1);
  release();
  assert.equal(await first, true);
  assert.equal(adapter.running, false);
  adapter.start();
  adapter.stop();
});
