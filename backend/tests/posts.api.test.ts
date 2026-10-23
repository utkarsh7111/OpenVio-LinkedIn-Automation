import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import express from 'express';
import { createMockServer } from '../../mock-linkedin/server.js';
import { createLinkedInRouter } from '../src/routes/linkedin.routes.js';
import { createPostController, createUploadController } from '../src/controllers/post.controller.js';
import { createPostService } from '../src/services/post.service.js';
import { createLinkedInService } from '../src/services/linkedin.service.js';
import { createStorageAdapter } from '../src/adapters/storage.js';
import { encryptToken } from '../src/utils/crypto.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const KEY = 'd'.repeat(64);
const PROJECT = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const USERS = { admin: '00000000-0000-4000-8000-000000000011', editor: '00000000-0000-4000-8000-000000000012', viewer: '00000000-0000-4000-8000-000000000013', foreign: '00000000-0000-4000-8000-000000000014', noModule: '00000000-0000-4000-8000-000000000015' };
const TOKEN = 'post-api-test-token';
const now = () => new Date();

class MemoryPosts {
  posts = new Map<string, any>(); events: any[] = []; notifications: any[] = []; calls = { claim: 0 };
  connection: any = { status: 'ACTIVE', projectId: PROJECT, authorUrn: 'urn:li:person:mock-member-001', access_token_encrypted: encryptToken(TOKEN, KEY), access_token_expires_at: new Date(Date.now() + 60 * 60_000).toISOString() };
  async getProjectId(id: string) { const post = this.posts.get(id); return post && !post.deletedAt ? post.projectId : null; }
  async create(input: any) {
    if (input.idempotencyKey) { const old = [...this.posts.values()].find((post) => post.projectId === input.projectId && post.idempotencyKey === input.idempotencyKey); if (old) return { post: structuredClone(old), created: false }; }
    const id = crypto.randomUUID(); const status = input.scheduledAt ? 'SCHEDULED' : 'DRAFT';
    const post = { id, projectId: input.projectId, content: input.content, media: input.media, status, scheduledAt: input.scheduledAt, publishedAt: null, linkedinPostUrn: null, errorCode: null, errorMessage: null, retryCount: 0, aiGenerated: input.aiGenerated, idempotencyKey: input.idempotencyKey, createdAt: now().toISOString(), updatedAt: now().toISOString(), deletedAt: null };
    this.posts.set(id, post);
    if (status === 'SCHEDULED') this.events.unshift({ postId: id, fromStatus: 'DRAFT', toStatus: status, detail: 'Scheduled on create' });
    return { post: structuredClone(post), created: true };
  }
  async get(id: string, projectId: string, includeEvents = false) {
    const post = this.posts.get(id);
    if (!post || post.deletedAt || post.projectId !== projectId) return null;
    return structuredClone({ ...post, ...(includeEvents ? { events: this.events.filter((event) => event.postId === id).toReversed() } : {}) });
  }
  async list({ projectId, status, page, limit, q }: any) {
    const all = [...this.posts.values()].filter((post) => post.projectId === projectId && !post.deletedAt && (!status || post.status === status) && (!q || post.content.includes(q)));
    return { items: structuredClone(all.slice((page - 1) * limit, page * limit)), total: all.length };
  }
  async update(input: any) {
    const post = this.posts.get(input.id); if (!post || post.projectId !== input.projectId || post.deletedAt) return null;
    const from = post.status; if (input.content !== undefined) post.content = input.content; if (input.media !== undefined) post.media = input.media;
    if (input.clearScheduledAt) post.scheduledAt = null; else if (input.scheduledAt !== undefined) post.scheduledAt = input.scheduledAt;
    if (input.status) post.status = input.status;
    if (input.clearError) { post.errorCode = null; post.errorMessage = null; }
    if (from !== post.status) this.events.unshift({ postId: post.id, fromStatus: from, toStatus: post.status, detail: input.detail });
    return structuredClone(post);
  }
  async claim({ id, projectId, actorUserId, retryOnly }: any) {
    this.calls.claim += 1;
    const post = this.posts.get(id); if (!post || post.projectId !== projectId || post.deletedAt) return null;
    const allowed = retryOnly ? ['FAILED'] : ['DRAFT', 'SCHEDULED', 'FAILED'];
    if (!allowed.includes(post.status)) return null;
    const from = post.status; post.status = 'PUBLISHING'; post.publishingStartedAt = now().toISOString();
    this.events.unshift({ postId: id, fromStatus: from, toStatus: 'PUBLISHING', actorUserId, detail: 'Publish claimed' });
    return structuredClone(post);
  }
  async setPublished({ id, projectId, urn, actorUserId }: any) {
    const post = this.posts.get(id); if (!post || post.projectId !== projectId || post.status !== 'PUBLISHING') return null;
    post.status = 'PUBLISHED'; post.linkedinPostUrn = urn; post.publishedAt = now().toISOString(); post.publishingStartedAt = null; post.errorCode = null; post.errorMessage = null;
    this.events.unshift({ postId: id, fromStatus: 'PUBLISHING', toStatus: 'PUBLISHED', actorUserId, detail: 'Published' });
    return structuredClone(post);
  }
  async setFailed({ id, projectId, code, message, actorUserId }: any) {
    const post = this.posts.get(id); if (!post || post.projectId !== projectId || post.status !== 'PUBLISHING') return null;
    post.status = 'FAILED'; post.errorCode = code; post.errorMessage = message; post.retryCount += 1; post.publishingStartedAt = null;
    this.events.unshift({ postId: id, fromStatus: 'PUBLISHING', toStatus: 'FAILED', actorUserId, detail: code });
    return structuredClone(post);
  }
  async saveImageUrn({ id, projectId, imageIndex, urn }: any) { const post = this.posts.get(id); post.media[imageIndex].linkedinImageUrn = urn; return structuredClone(post); }
  async softDelete(id: string, projectId: string) { const post = this.posts.get(id); if (!post || post.projectId !== projectId || post.deletedAt) return null; post.deletedAt = now().toISOString(); return { id }; }
  async getActiveConnection(projectId: string) { return projectId === PROJECT && ['ACTIVE', 'EXPIRED'].includes(this.connection.status) ? structuredClone(this.connection) : null; }
  async markConnectionExpired(projectId: string) { if (projectId === PROJECT) this.connection.status = 'EXPIRED'; }
  async getNotifications(projectId: string, limit: number) { return projectId === PROJECT ? structuredClone(this.notifications.slice(0, limit)) : []; }
}

let mock: any, base: string, server: any, data: MemoryPosts, storage: any, uploadsDir: string, strictHits: string[], apiCalls: number;
function mockBaseUrl() { return `http://127.0.0.1:${(mock.address() as AddressInfo).port}`; }

async function failNext(status: number, pathName = '/rest/posts', method = 'POST', extra = {}) {
  const res = await fetch(`${mockBaseUrl()}/admin/fail-next`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, count: 1, path: pathName, method, ...extra }) });
  assert.equal(res.status, 201);
}
function multipart({ boundary = 'vio-boundary', projectId = PROJECT, altText = 'sample', bytes = pngBytes() } = {}) {
  const fileHeader = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="projectId"\r\n\r\n${projectId}\r\n--${boundary}\r\nContent-Disposition: form-data; name="altText"\r\n\r\n${altText}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fake.exe"\r\nContent-Type: application/x-msdownload\r\n\r\n`);
  return Buffer.concat([fileHeader, bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
}
function pngBytes() { const b = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b); b.writeUInt32BE(1, 16); b.writeUInt32BE(1, 20); return b; }
async function request(pathname: string, { user = USERS.admin, method = 'GET', body, headers = {} }: any = {}) {
  return fetch(`${base}/api/linkedin${pathname}`, { method, headers: { 'x-user-id': user, ...(body && !(body instanceof Buffer) ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : body instanceof Buffer ? body : JSON.stringify(body) });
}

before(async () => {
  uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openvio-post-api-'));
  mock = createMockServer(); await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', () => resolve()));
  const mockBase = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
  data = new MemoryPosts(); mock.mockState.tokens.set(TOKEN, { sub: 'mock-member-001', scope: 'openid profile w_member_social', expiresAt: Date.now() + 60 * 60_000 });
  storage = createStorageAdapter({ directory: uploadsDir, baseUrl: 'http://127.0.0.1:4300', maxBytes: 1024 });
  strictHits = []; apiCalls = 0;
  const linkedin = createLinkedInService({ config: { linkedinApiBase: mockBase, linkedinOAuthBase: mockBase, linkedinApiVersion: '202601', linkedinHttpTimeoutMs: 1000, linkedinClientId: 'mock-client-id', linkedinClientSecret: 'mock-client-secret', tokenEncryptionKey: KEY } as any, fetchImpl: async (url: any, options: any) => { if (new URL(url).pathname === '/rest/posts' && options.method === 'POST') apiCalls += 1; return fetch(url, options); } });
  const projects = {
    getProject: async (id: string) => [PROJECT, OTHER].includes(id) ? { id } : null,
    getMembership: async (id: string, userId: string) => {
      if (id === PROJECT && [USERS.admin, USERS.editor, USERS.viewer, USERS.noModule].includes(userId)) return { role: ({ [USERS.admin]: 'ADMIN', [USERS.editor]: 'EDITOR', [USERS.viewer]: 'VIEWER', [USERS.noModule]: 'EDITOR' })[userId], linkedin_module_access: userId !== USERS.noModule };
      if (id === OTHER && userId === USERS.foreign) return { role: 'EDITOR', linkedin_module_access: true };
      return null;
    },
  };
  const ai = { generate: async ({ topic, tone, length }: any) => { if (topic === 'fail topic') throw new Error('secret provider text'); return { text: `${topic}\n\nGenerated in ${tone}, ${length}.`, truncated: false }; }, enhance: async ({ content, action }: any) => ({ text: action === 'professional' ? content.replace(/\bcan't\b/gi, 'cannot') : content.trim(), truncated: false, mock: true }) };
  const notify = { notify: async (item: any) => { data.notifications.unshift({ id: crypto.randomUUID(), ...item, createdAt: now().toISOString() }); } };
  const postService = createPostService({ data: data as any, linkedin: linkedin as any, storage, ai: ai as any, notify, config: { mediaMaxBytes: 1024, publicApiBaseUrl: 'http://127.0.0.1:4300' } as any });
  const controller = createPostController(postService, { linkedinMode: 'mock' } as any);
  const auth = { authenticate: async (req: any) => req.headers['x-user-id'] ? { id: req.headers['x-user-id'] } : null };
  const app = express(); app.use(express.json());
  app.use('/api/linkedin', createLinkedInRouter({ controller: { begin: (_req: any, res: any) => res.status(501).end(), callback: (_req: any, res: any) => res.status(501).end(), get: (_req: any, res: any) => res.status(501).end(), disconnect: (_req: any, res: any) => res.status(501).end() }, postController: controller, postData: data as any, auth: auth as any, projects: projects as any, sensitiveLimiter: (req: any, _res: any, next: any) => { strictHits.push(req.path); next(); }, mediaLimit: 1024 }));
  app.get('/uploads/:name', createUploadController(storage));
  app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status ?? 500).json({ success: false, data: null, error: { code: error.code ?? 'INTERNAL_ERROR', message: error.message, ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) } }));
  server = app.listen(0, '127.0.0.1'); await new Promise<void>((resolve) => server.once('listening', () => resolve())); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => { if (server) await new Promise<void>((resolve) => server.close(() => resolve())); if (mock) await new Promise<void>((resolve) => mock.close(() => resolve())); if (uploadsDir) await fs.rm(uploadsDir, { recursive: true, force: true }); });

beforeEach(() => { data.posts.clear(); data.events.length = 0; data.notifications.length = 0; data.calls.claim = 0; data.connection.status = 'ACTIVE'; apiCalls = 0; strictHits.length = 0; for (const name of ['images', 'uploads', 'posts']) mock.mockState[name].clear(); mock.mockState.failures.length = 0; });

test('post CRUD, list/detail history, idempotent create, schedule, unschedule, publish, retry, and delete endpoints', async () => {
  const createdRes = await request('/posts', { method: 'POST', body: { projectId: PROJECT, content: 'first post', idempotencyKey: 'same-key' } });
  assert.equal(createdRes.status, 201); const created = ((await createdRes.json()) as any).data;
  const duplicate = await request('/posts', { method: 'POST', body: { projectId: PROJECT, content: 'different request', idempotencyKey: 'same-key' } });
  assert.equal(duplicate.status, 200); assert.equal(((await duplicate.json()) as any).data.id, created.id);
  assert.equal((await request(`/posts?projectId=${PROJECT}`)).status, 200);
  const detail = await request(`/posts/${created.id}`); assert.equal(detail.status, 200); assert.deepEqual(((await detail.json()) as any).data.events, []);
  const edited = await request(`/posts/${created.id}`, { method: 'PUT', body: { content: 'edited' } }); assert.equal(((await edited.json()) as any).data.content, 'edited');
  const scheduledAt = new Date(Date.now() + 10 * 60_000).toISOString();
  assert.equal((await request(`/posts/${created.id}/schedule`, { method: 'POST', body: { scheduledAt: new Date(Date.now() - 60_000).toISOString() } })).status, 422);
  assert.equal((await request(`/posts/${created.id}/schedule`, { method: 'POST', body: { scheduledAt } })).status, 200);
  assert.equal((await request(`/posts/${created.id}/unschedule`, { method: 'POST' })).status, 200);
  await failNext(500);
  const failed = await request(`/posts/${created.id}/publish`, { method: 'POST', body: {} }); assert.equal(failed.status, 502); assert.equal(((await failed.json()) as any).error.code, 'LINKEDIN_UNAVAILABLE');
  const retried = await request(`/posts/${created.id}/retry`, { method: 'POST', body: {} }); assert.equal(retried.status, 200); const published = ((await retried.json()) as any).data;
  assert.equal(published.status, 'PUBLISHED'); assert.match(published.linkedinPostUrn, /^urn:li:share:/); assert.equal(published.linkedinPostUrl, null, 'mock URNs must not be presented as real LinkedIn post links');
  const publishedGet = await request(`/posts/${created.id}`); assert.ok(((await publishedGet.json()) as any).data.events.length >= 5);
  const deleted = await request(`/posts/${created.id}`, { method: 'DELETE' }); assert.deepEqual(((await deleted.json()) as any).data, { id: created.id, deleted: true });
  assert.equal((await request(`/posts/${created.id}`)).status, 404);
  assert.ok(strictHits.includes(`/posts/${created.id}/publish`)); assert.ok(strictHits.includes(`/posts/${created.id}/retry`)); assert.ok(strictHits.includes(`/posts/${created.id}/schedule`));
});

test('AI enhancement validates inputs, returns an explicitly marked mock suggestion, and enforces editor permissions', async () => {
  const requestBody = { projectId: PROJECT, content: 'i want to share our project update', action: 'professional' };
  const response = await request('/ai/enhance', { method: 'POST', body: requestBody });
  assert.equal(response.status, 200);
  const result = ((await response.json()) as any).data;
  assert.equal(result.mock, true);
  assert.equal(typeof result.text, 'string');
  assert.ok(result.text.length > 0 && result.text.length <= 3000);
  assert.equal((await request('/ai/enhance', { method: 'POST', body: { ...requestBody, action: 'publish_it' } })).status, 400);
  assert.equal((await request('/ai/enhance', { method: 'POST', body: { ...requestBody, content: '   ' } })).status, 400);
  assert.equal((await request('/ai/enhance', { method: 'POST', body: { ...requestBody, content: 'x'.repeat(3001) } })).status, 400);
  assert.equal((await request('/ai/enhance', { method: 'POST', body: requestBody, user: USERS.viewer })).status, 403);
});

test('validation covers 0, 1, 3000, 3001, whitespace, and unknown fields without values', async () => {
  for (const content of ['', '   ', 'x'.repeat(3001)]) {
    const res = await request('/posts', { method: 'POST', body: { projectId: PROJECT, content } }); assert.equal(res.status, 400); assert.equal(((await res.json()) as any).error.code, 'VALIDATION_ERROR');
  }
  assert.equal((await request('/posts', { method: 'POST', body: { projectId: PROJECT, content: 'x' } })).status, 201);
  assert.equal((await request('/posts', { method: 'POST', body: { projectId: PROJECT, content: 'x'.repeat(3000) } })).status, 201);
  const unknown = await request('/posts', { method: 'POST', body: { projectId: PROJECT, content: 'secret-value', surprise: 'never echo' } });
  assert.equal(unknown.status, 400); const message = await unknown.text(); assert.match(message, /surprise/); assert.doesNotMatch(message, /never echo|secret-value/);
  assert.equal((await request(`/posts?projectId=${PROJECT}&extra=1`)).status, 400);
  assert.equal((await request(`/posts/00000000-0000-4000-8000-000000000011?extra=1`)).status, 400);
  assert.equal((await request('/posts', { method: 'POST', body: { projectId: PROJECT, content: 'external media', media: [{ url: 'https://attacker.invalid/image.png' }] } })).status, 400);
  assert.equal((await request('/posts/not-a-uuid')).status, 400);
});

test('role and project access matrix allows reads, denies viewer writes, returns cross-project 404', async () => {
  const create = await request('/posts', { method: 'POST', body: { projectId: PROJECT, content: 'role test' }, user: USERS.editor }); const id = ((await create.json()) as any).data.id;
  assert.equal((await request(`/posts/${id}`, { user: USERS.viewer })).status, 200);
  assert.equal((await request(`/posts/${id}`, { method: 'PUT', user: USERS.viewer, body: { content: 'blocked' } })).status, 403);
  assert.equal((await request('/posts', { method: 'POST', user: USERS.viewer, body: { projectId: PROJECT, content: 'blocked' } })).status, 403);
  assert.equal((await request(`/posts/${id}/publish`, { method: 'POST', user: USERS.viewer, body: {} })).status, 403);
  assert.equal((await request(`/posts/${id}`, { user: USERS.noModule })).status, 403);
  assert.equal((await request(`/posts/${id}`, { user: '00000000-0000-4000-8000-000000000099' })).status, 404);
  const foreign = await data.create({ projectId: OTHER, userId: USERS.foreign, content: 'foreign', media: [], aiGenerated: false });
  assert.equal((await request(`/posts/${foreign.post.id}`, { user: USERS.admin })).status, 404);
  assert.equal((await request(`/posts/${id}`, { user: USERS.foreign })).status, 404);
  assert.equal((await request('/posts?projectId=00000000-0000-4000-8000-000000000099')).status, 404);
});

test('published edits update commentary remotely; published delete is provider-first and status transitions are enforced', async () => {
  const created = await request('/posts', { method: 'POST', body: { projectId: PROJECT, content: 'publish me' } }); const id = ((await created.json()) as any).data.id;
  const published = await request(`/posts/${id}/publish`, { method: 'POST', body: {} }); assert.equal(published.status, 200);
  const urn = ((await published.json()) as any).data.linkedinPostUrn;
  assert.equal((await request(`/posts/${id}`, { method: 'PUT', body: { content: 'published edit' } })).status, 200);
  assert.equal(((await (await fetch(`${mockBaseUrl()}/admin/posts`)).json()) as any[]).find((p: any) => p.id === urn).commentary, 'published edit');
  assert.equal((await request(`/posts/${id}/publish`, { method: 'POST', body: {} })).status, 409);
  assert.equal(apiCalls, 1);
  const failureDeletePost = await request('/posts', { method: 'POST', body: { projectId: PROJECT, content: 'will publish-delete fail' } }); const deleteId = ((await failureDeletePost.json()) as any).data.id;
  await request(`/posts/${deleteId}/publish`, { method: 'POST', body: {} });
  await failNext(403, `/rest/posts/${encodeURIComponent(data.posts.get(deleteId).linkedinPostUrn)}`, 'DELETE');
  const failedDelete = await request(`/posts/${deleteId}`, { method: 'DELETE' }); assert.equal(failedDelete.status, 403); assert.equal(data.posts.get(deleteId).deletedAt, null);
  const deleteSuccessMade = await request('/posts', { method: 'POST', body: { projectId: PROJECT, content: 'provider delete succeeds' } }); const deleteSuccessId = ((await deleteSuccessMade.json()) as any).data.id;
  await request(`/posts/${deleteSuccessId}/publish`, { method: 'POST', body: {} });
  const deleteUrn = data.posts.get(deleteSuccessId).linkedinPostUrn;
  assert.equal((await request(`/posts/${deleteSuccessId}`, { method: 'DELETE' })).status, 200);
  assert.equal(((await (await fetch(`${mockBaseUrl()}/admin/posts`)).json()) as any[]).some((post: any) => post.id === deleteUrn), false);
  assert.equal((await request(`/posts/${id}/schedule`, { method: 'POST', body: { scheduledAt: new Date(Date.now() + 600_000).toISOString() } })).status, 409);
  assert.equal((await request(`/posts/${id}`, { method: 'PUT', body: { content: 'no media change rule', media: [] } })).status, 409);
});

test('concurrent Publish Now requests claim once and make exactly one LinkedIn create call', async () => {
  const created = await request('/posts', { method: 'POST', body: { projectId: PROJECT, content: 'only once' } }); const id = ((await created.json()) as any).data.id;
  const [first, second] = await Promise.all([request(`/posts/${id}/publish`, { method: 'POST', body: {} }), request(`/posts/${id}/publish`, { method: 'POST', body: {} })]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]); assert.equal(apiCalls, 1); assert.equal(data.calls.claim, 1);
});

test('provider failures store exact safe code and message and notify without provider text', async (t) => {
  const cases: Array<[number, number, string, string]> = [
    [401, 409, 'RECONNECT_REQUIRED', 'Your LinkedIn connection expired. Reconnect LinkedIn.'],
    [403, 403, 'LINKEDIN_SCOPE', 'LinkedIn does not allow this action for the connected account.'],
    [422, 422, 'LINKEDIN_REJECTED', 'LinkedIn rejected this post. Check the text and image.'],
    [429, 429, 'LINKEDIN_RATE_LIMITED', 'LinkedIn rate limited this request. Try again later.'],
    [500, 502, 'LINKEDIN_UNAVAILABLE', 'LinkedIn is not responding. Try again in a few minutes.'],
  ];
  for (const [injected, status, code, message] of cases) await t.test(`provider ${injected}`, async () => {
    data.connection.status = 'ACTIVE';
    const made = await request('/posts', { method: 'POST', body: { projectId: PROJECT, content: `failure ${injected}` } }); const id = ((await made.json()) as any).data.id;
    await failNext(injected, '/rest/posts', 'POST', injected === 429 ? { retryAfter: 12 } : {});
    const response = await request(`/posts/${id}/publish`, { method: 'POST', body: {} }); const body: any = await response.json();
    assert.equal(response.status, status); assert.equal(body.error.code, code); assert.equal(body.error.message, message);
    if (injected === 429) assert.equal(body.error.retryAfterSeconds, 12);
    const stored = data.posts.get(id); assert.equal(stored.status, 'FAILED'); assert.equal(stored.errorCode, code); assert.equal(stored.errorMessage, message); assert.equal(stored.retryCount, 1);
    assert.equal(data.notifications.at(-1).message, message); assert.doesNotMatch(JSON.stringify(body) + JSON.stringify(data.notifications), /post-api-test-token|Injected mock/);
    if (injected === 401) {
      assert.equal(data.connection.status, 'EXPIRED');
      const subsequent = await request(`/posts/${id}/retry`, { method: 'POST', body: {} });
      assert.equal(subsequent.status, 409); assert.equal(((await subsequent.json()) as any).error.code, 'RECONNECT_REQUIRED');
    }
  });
});

test('media multipart upload sniffs bytes, serves safe headers, rejects spoofed content, and blocks traversal', async () => {
  const boundary = 'vio-boundary';
  const uploaded = await request('/media', { method: 'POST', body: multipart({ boundary }), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } });
  const uploadedText = await uploaded.text(); assert.equal(uploaded.status, 201, uploadedText); const media = JSON.parse(uploadedText).data; assert.equal(media.type, 'image/png'); assert.equal(media.altText, 'sample'); assert.match(media.url, /\.png$/);
  const served = await fetch(`${base}${new URL(media.url).pathname}`); assert.equal(served.status, 200); assert.equal(served.headers.get('content-type'), 'image/png'); assert.equal(served.headers.get('x-content-type-options'), 'nosniff'); assert.equal(served.headers.get('content-disposition'), 'attachment');
  const withImage = await request('/posts', { method: 'POST', body: { projectId: PROJECT, content: 'publish uploaded image', media: [{ url: media.url, altText: media.altText }] } }); const imagePost = ((await withImage.json()) as any).data;
  const imagePublished = await request(`/posts/${imagePost.id}/publish`, { method: 'POST', body: {} }); assert.equal(imagePublished.status, 200);
  const imageURN = data.posts.get(imagePost.id).media[0].linkedinImageUrn; assert.match(imageURN, /^urn:li:image:/);
  const providerImagePost = ((await (await fetch(`${mockBaseUrl()}/admin/posts`)).json()) as any[]).find((post: any) => post.id === data.posts.get(imagePost.id).linkedinPostUrn);
  assert.equal(providerImagePost.content.media.id, imageURN);
  const failedImageMade = await request('/posts', { method: 'POST', body: { projectId: PROJECT, content: 'upload should fail', media: [{ url: media.url }] } }); const failedImage = ((await failedImageMade.json()) as any).data;
  await failNext(500, '/rest/images', 'POST');
  const imageFailure = await request(`/posts/${failedImage.id}/publish`, { method: 'POST', body: {} }); assert.equal(imageFailure.status, 502); assert.equal(((await imageFailure.json()) as any).error.code, 'LINKEDIN_UNAVAILABLE');
  const spoofed = await request('/media', { method: 'POST', body: multipart({ boundary, bytes: Buffer.from('<html>') }), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } }); assert.equal(spoofed.status, 415);
  const oversizedBytes = Buffer.alloc(1025); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(oversizedBytes); oversizedBytes.writeUInt32BE(1, 16); oversizedBytes.writeUInt32BE(1, 20);
  const oversized = await request('/media', { method: 'POST', body: multipart({ boundary, bytes: oversizedBytes }), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } }); assert.equal(oversized.status, 413);
  assert.equal((await fetch(`${base}/uploads/..%2F..%2Fpackage.json`)).status, 404);
  assert.equal((await request('/media', { method: 'POST', body: {}, headers: { 'Content-Type': 'application/json' } })).status, 415);
  assert.ok(strictHits.includes('/media'));
});

test('AI generate validates inputs, returns deterministic output, and failure preserves user post content', async () => {
  const userPost = await request('/posts', { method: 'POST', body: { projectId: PROJECT, content: 'keep my writing intact' } }); const original = ((await userPost.json()) as any).data;
  const generated = await request('/ai/generate', { method: 'POST', body: { projectId: PROJECT, topic: 'A new campaign', tone: 'professional', length: 'short' } }); assert.equal(generated.status, 200); assert.match(((await generated.json()) as any).data.text, /A new campaign/);
  const failure = await request('/ai/generate', { method: 'POST', body: { projectId: PROJECT, topic: 'fail topic', tone: 'professional', length: 'short' } }); assert.equal(failure.status, 502); assert.equal(((await failure.json()) as any).error.code, 'AI_UNAVAILABLE');
  assert.equal(((await (await request(`/posts/${original.id}`)).json()) as any).data.content, 'keep my writing intact');
  assert.equal((await request('/ai/generate', { method: 'POST', body: { projectId: PROJECT, topic: 'ab', tone: 'professional', length: 'short' } })).status, 400);
  assert.ok(strictHits.includes('/ai/generate'));
});

test('notifications endpoint is project-scoped and bounded', async () => {
  data.notifications.push({ id: 'notification-1', type: 'POST_FAILED', message: 'Safe message', createdAt: now().toISOString() });
  const response = await request(`/notifications?projectId=${PROJECT}&limit=5`); assert.equal(response.status, 200); assert.equal(((await response.json()) as any).data.items.length, 1);
  assert.equal((await request(`/notifications?projectId=${OTHER}`, { user: USERS.admin })).status, 403);
  assert.equal((await request(`/notifications?projectId=${PROJECT}&extra=x`)).status, 400);
});
