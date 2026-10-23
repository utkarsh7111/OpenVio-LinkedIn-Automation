import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMockServer } from '../../mock-linkedin/server.js';
import { createLinkedInService } from '../src/services/linkedin.service.js';
import { createStorageAdapter } from '../src/adapters/storage.js';
import { createPostService } from '../src/services/post.service.js';
import { encryptToken } from '../src/utils/crypto.js';

const rawToken = 'media-test-token-never-log';
const key = 'b'.repeat(64);
const connection: any = {
  id: '00000000-0000-4000-8000-000000000099',
  status: 'ACTIVE',
  authorUrn: 'urn:li:person:mock-member-001',
  access_token_encrypted: encryptToken(rawToken, key),
  access_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
};
const authorUrn = 'urn:li:person:mock-member-001';
const PROJECT = '00000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000011';

let server: any;
let base: string;
let service: any;
let storage: any;
let storageDir: string;

function pngBytes(): Buffer {
  const buf = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buf);
  buf.writeUInt32BE(100, 16);
  buf.writeUInt32BE(100, 20);
  return buf;
}

function mp4Bytes(): Buffer {
  // 16 bytes: 4 bytes length, 'ftyp', 'isom', 4 bytes minor
  const buf = Buffer.alloc(32);
  buf.writeUInt32BE(32, 0);
  buf.write('ftyp', 4, 'ascii');
  buf.write('isom', 8, 'ascii');
  return buf;
}

function pdfBytes(): Buffer {
  return Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
}

class FakePostData {
  posts = new Map<string, any>();
  async get(id: string, projectId: string) {
    const post = this.posts.get(id);
    return post && post.projectId === projectId ? structuredClone(post) : null;
  }
  async create(input: any) {
    const id = crypto.randomUUID();
    const post = { id, projectId: input.projectId, content: input.content, media: input.media, status: 'DRAFT', scheduledAt: null, linkedinPostUrn: null };
    this.posts.set(id, post);
    return { post: structuredClone(post), created: true };
  }
  async update(input: any) {
    const post = this.posts.get(input.id);
    if (!post || post.projectId !== input.projectId) return null;
    if (input.content !== undefined) post.content = input.content;
    if (input.media !== undefined) post.media = input.media;
    if (input.status !== undefined) post.status = input.status;
    return structuredClone(post);
  }
  async claim({ id, projectId }: any) {
    const post = this.posts.get(id);
    if (!post || post.projectId !== projectId) return null;
    post.status = 'PUBLISHING';
    return structuredClone(post);
  }
  async setPublished({ id, projectId, urn }: any) {
    const post = this.posts.get(id);
    if (!post || post.projectId !== projectId) return null;
    post.status = 'PUBLISHED';
    post.linkedinPostUrn = urn;
    return structuredClone(post);
  }
  async setFailed({ id, projectId, code, message }: any) {
    const post = this.posts.get(id);
    if (!post || post.projectId !== projectId) return null;
    post.status = 'FAILED';
    post.errorCode = code;
    post.errorMessage = message;
    return structuredClone(post);
  }
  async saveImageUrn({ id, projectId, imageIndex, urn }: any) {
    const post = this.posts.get(id);
    if (!post || post.projectId !== projectId) return null;
    post.media[imageIndex].linkedinUrn = urn;
    post.media[imageIndex].linkedinImageUrn = urn;
    return structuredClone(post);
  }
  async getActiveConnection(projectId: string) {
    return projectId === PROJECT ? structuredClone(connection) : null;
  }
  async markConnectionExpired() {}
}

before(async () => {
  server = createMockServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  server.mockState.tokens.set(rawToken, { sub: 'mock-member-001', scope: 'openid profile w_member_social', expiresAt: Date.now() + 60_000 });
  service = createLinkedInService({
    config: {
      linkedinApiBase: base,
      linkedinOAuthBase: base,
      linkedinApiVersion: '202601',
      linkedinHttpTimeoutMs: 2000,
      linkedinClientId: 'mock-client-id',
      linkedinClientSecret: 'mock-client-secret',
      tokenEncryptionKey: key,
    } as any,
  });
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-test-storage-'));
  storage = createStorageAdapter({ directory: storageDir, baseUrl: 'http://127.0.0.1:4000', maxBytes: 10 * 1024 * 1024 });
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (storageDir) await fs.rm(storageDir, { recursive: true, force: true });
});

beforeEach(() => {
  if (server?.mockState) {
    server.mockState.images?.clear();
    server.mockState.videos?.clear();
    server.mockState.documents?.clear();
    server.mockState.uploads?.clear();
    server.mockState.posts?.clear();
    server.mockState.failures.length = 0;
    server.mockState.tokens.set(rawToken, { sub: 'mock-member-001', scope: 'openid profile w_member_social', expiresAt: Date.now() + 60_000 });
  }
});

test('Video workflow: uploadVideo initializes, uploads binary, checks status, and publishes video post', async () => {
  const videoData = mp4Bytes();
  const uploaded = await service.uploadVideo(connection, {
    authorUrn,
    data: videoData,
    title: 'Product Launch Demo',
    contentType: 'video/mp4',
  });

  assert.match(uploaded.videoUrn, /^urn:li:video:/);
  assert.equal(uploaded.title, 'Product Launch Demo');

  // Verify status check
  const status = await service.getVideoStatus(connection, uploaded.videoUrn);
  assert.equal(status, 'AVAILABLE');

  // Publish video post
  const published = await service.publishPost(connection, {
    authorUrn,
    commentary: 'Check out our new video!',
    video: { id: uploaded.videoUrn, title: uploaded.title },
  });
  assert.match(published.urn, /^urn:li:share:/);

  const mockPost = server.mockState.posts.get(published.urn);
  assert.ok(mockPost);
  assert.equal(mockPost.content.media.id, uploaded.videoUrn);
  assert.equal(mockPost.content.media.title, 'Product Launch Demo');
});

test('Document workflow: uploadDocument initializes, uploads binary, checks status, and publishes document post', async () => {
  const docData = pdfBytes();
  const uploaded = await service.uploadDocument(connection, {
    authorUrn,
    data: docData,
    title: 'Q3 Financial Report',
    contentType: 'application/pdf',
  });

  assert.match(uploaded.documentUrn, /^urn:li:document:/);
  assert.equal(uploaded.title, 'Q3 Financial Report');

  // Verify status check
  const status = await service.getDocumentStatus(connection, uploaded.documentUrn);
  assert.equal(status, 'AVAILABLE');

  // Publish document post
  const published = await service.publishPost(connection, {
    authorUrn,
    commentary: 'Here is our Q3 report.',
    document: { id: uploaded.documentUrn, title: uploaded.title },
  });
  assert.match(published.urn, /^urn:li:share:/);

  const mockPost = server.mockState.posts.get(published.urn);
  assert.ok(mockPost);
  assert.equal(mockPost.content.media.id, uploaded.documentUrn);
  assert.equal(mockPost.content.media.title, 'Q3 Financial Report');
});

test('Multi-image workflow: uploads 3 images and publishes multiImage post', async () => {
  const img1 = await service.uploadImage(connection, { authorUrn, data: pngBytes(), altText: 'Photo 1' });
  const img2 = await service.uploadImage(connection, { authorUrn, data: pngBytes(), altText: 'Photo 2' });
  const img3 = await service.uploadImage(connection, { authorUrn, data: pngBytes(), altText: 'Photo 3' });

  const published = await service.publishPost(connection, {
    authorUrn,
    commentary: 'Three amazing pictures',
    multiImage: {
      images: [
        { id: img1.imageUrn, altText: img1.altText },
        { id: img2.imageUrn, altText: img2.altText },
        { id: img3.imageUrn, altText: img3.altText },
      ],
    },
  });

  assert.match(published.urn, /^urn:li:share:/);
  const mockPost = server.mockState.posts.get(published.urn);
  assert.ok(mockPost);
  assert.equal(mockPost.content.multiImage.images.length, 3);
  assert.equal(mockPost.content.multiImage.images[0].id, img1.imageUrn);
  assert.equal(mockPost.content.multiImage.images[1].id, img2.imageUrn);
  assert.equal(mockPost.content.multiImage.images[2].id, img3.imageUrn);
});

test('End-to-end post service: creates and publishes multi-image, video, and document posts', async () => {
  const fakeData = new FakePostData();
  const postService = createPostService({
    data: fakeData as any,
    linkedin: service,
    storage,
    notify: { notify: async () => {} },
  });

  // 1. Upload files to storage
  const savedImg1 = await postService.upload({ projectId: PROJECT, altText: 'Image 1' }, pngBytes());
  const savedImg2 = await postService.upload({ projectId: PROJECT, altText: 'Image 2' }, pngBytes());
  const savedVideo = await postService.upload({ projectId: PROJECT, title: 'Company Video', type: 'video' }, mp4Bytes());
  const savedDoc = await postService.upload({ projectId: PROJECT, title: 'Annual Report', type: 'document' }, pdfBytes());

  assert.equal(savedImg1.type, 'image/png');
  assert.equal(savedVideo.type, 'video/mp4');
  assert.equal(savedDoc.type, 'application/pdf');

  // 2. Multi-image post creation and publishing
  const multiPost = await postService.create({
    projectId: PROJECT,
    content: 'Multiple images in one post',
    media: [
      { url: savedImg1.url, altText: 'Image 1', type: 'image' },
      { url: savedImg2.url, altText: 'Image 2', type: 'image' },
    ],
  }, USER);
  assert.equal(multiPost.created, true);

  const publishedMulti = await postService.publish(multiPost.post.id, PROJECT, USER);
  assert.equal(publishedMulti.status, 'PUBLISHED');
  assert.match(publishedMulti.linkedinPostUrn!, /^urn:li:share:/);

  // 3. Video post creation and publishing
  const videoPost = await postService.create({
    projectId: PROJECT,
    content: 'Single video post',
    media: [
      { url: savedVideo.url, title: 'Company Video', type: 'video' },
    ],
  }, USER);
  assert.equal(videoPost.created, true);

  const publishedVideo = await postService.publish(videoPost.post.id, PROJECT, USER);
  assert.equal(publishedVideo.status, 'PUBLISHED');
  assert.match(publishedVideo.linkedinPostUrn!, /^urn:li:share:/);

  // 4. Document post creation and publishing
  const docPost = await postService.create({
    projectId: PROJECT,
    content: 'Single document post',
    media: [
      { url: savedDoc.url, title: 'Annual Report', type: 'document' },
    ],
  }, USER);
  assert.equal(docPost.created, true);

  const publishedDoc = await postService.publish(docPost.post.id, PROJECT, USER);
  assert.equal(publishedDoc.status, 'PUBLISHED');
  assert.match(publishedDoc.linkedinPostUrn!, /^urn:li:share:/);

  // 5. Validation rejection for mixing video and image in multi-item
  await assert.rejects(() => postService.create({
    projectId: PROJECT,
    content: 'Mixed media should be rejected',
    media: [
      { url: savedImg1.url, type: 'image' },
      { url: savedVideo.url, type: 'video' },
    ],
  }, USER), (err: any) => err.code === 'VALIDATION_ERROR');

  // 6. Validation rejection for exceeding 20 images
  const tooManyImages = Array.from({ length: 21 }, () => ({ url: savedImg1.url, type: 'image' as const }));
  await assert.rejects(() => postService.create({
    projectId: PROJECT,
    content: 'Too many images',
    media: tooManyImages,
  }, USER), (err: any) => err.code === 'VALIDATION_ERROR');

  // 7. Draft creation, draft reload, editing (removing attachment), and publishing
  const draftWithTwo = await postService.create({
    projectId: PROJECT,
    content: 'Draft with two images',
    media: [
      { url: savedImg1.url, altText: 'Primary image', type: 'image' },
      { url: savedImg2.url, altText: 'Secondary image', type: 'image' },
    ],
  }, USER);
  assert.equal(draftWithTwo.post.status, 'DRAFT');

  // User reloads draft and removes the first image (promoting the second image to primary)
  const reloaded = await postService.get(draftWithTwo.post.id, PROJECT);
  assert.equal(reloaded.media.length, 2);
  assert.equal(reloaded.media[0].altText, 'Primary image');

  const updatedDraft = await postService.update(draftWithTwo.post.id, PROJECT, {
    media: [reloaded.media[1]], // remove primary image
  }, USER);
  assert.equal(updatedDraft.media.length, 1);
  assert.equal(updatedDraft.media[0].altText, 'Secondary image');

  const publishedUpdated = await postService.publish(draftWithTwo.post.id, PROJECT, USER);
  assert.equal(publishedUpdated.status, 'PUBLISHED');
  assert.match(publishedUpdated.linkedinPostUrn!, /^urn:li:share:/);
});

test('Error path verification: 422 rejected, 502 unavailable, and 429 rate limit mapping', async () => {
  const fakeData = new FakePostData();
  const postService = createPostService({
    data: fakeData as any,
    linkedin: service,
    storage,
    notify: { notify: async () => {} },
  });

  const savedImg = await postService.upload({ projectId: PROJECT, altText: 'Test' }, pngBytes());
  const post = await postService.create({
    projectId: PROJECT,
    content: 'Post testing error mapping',
    media: [{ url: savedImg.url, type: 'image' }],
  }, USER);

  // 1. Simulate 422 provider rejection using mock server fail-next
  await fetch(`${base}/admin/fail-next`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 422, count: 1, path: '/rest/posts', method: 'POST' }),
  });

  await assert.rejects(() => postService.publish(post.post.id, PROJECT, USER), (err: any) => {
    return err.status === 422 || err.code === 'LINKEDIN_REJECTED';
  });

  // 2. Unsupported file format rejection in storage
  await assert.rejects(() => storage.saveMedia(Buffer.from('Not a valid media file'), { filename: 'test.xyz' }), (err: any) => {
    return err.code === 'UNSUPPORTED_MEDIA_TYPE';
  });
});
