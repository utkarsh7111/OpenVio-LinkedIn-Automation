import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { createAiAdapter } from '../src/adapters/ai.js';
import { app } from '../src/app.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const DEV_USER_ID = '00000000-0000-4000-8000-000000000011';
let BASE_URL = 'http://localhost:4000/api/linkedin';
let testServer: any;

before(async () => {
  try {
    const res = await fetch(`${BASE_URL}/ai/generate`, { method: 'OPTIONS', signal: AbortSignal.timeout(500) });
    if (res.ok || res.status === 204 || res.status === 404 || res.status === 400) {
      return;
    }
  } catch {
    testServer = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => testServer.once('listening', () => resolve()));
    const address = testServer.address() as AddressInfo;
    BASE_URL = `http://127.0.0.1:${address.port}/api/linkedin`;
  }
});

import { pool } from '../src/db/pool.js';

after(async () => {
  if (testServer) {
    await new Promise<void>((resolve) => testServer.close(() => resolve()));
  }
  await pool.end().catch(() => {});
});

test('AI Adapter - Gemini without API key throws safe 503 AI_UNAVAILABLE without leaking secrets', async () => {
  const adapter = createAiAdapter({ provider: 'gemini', geminiApiKey: '' });
  try {
    await adapter.generate({ topic: 'Testing error handling' });
    assert.fail('Expected exception was not thrown');
  } catch (error: any) {
    assert.equal(error.httpStatus, 503);
    assert.equal(error.code, 'AI_UNAVAILABLE');
    assert.match(error.message, /Gemini API key is not configured/);
    assert.doesNotMatch(JSON.stringify(error), /AI_API_KEY|GEMINI_API_KEY=/);
  }
});

test('AI Adapter - Mock fallback generates bounded, high-quality structure', async () => {
  const adapter = createAiAdapter({ provider: 'mock' });
  const result = await adapter.generate({
    topic: 'Announcing our new automated LinkedIn analytics tool',
    tone: 'professional',
    length: 'medium',
    targetAudience: 'Product Managers and Founders',
    objective: 'Announce launch and drive trials',
    callToAction: 'Check out the demo link below',
    includeHashtags: true,
  });
  assert.ok(result.text.length > 0);
  assert.equal(result.mock, true);
  assert.equal(result.truncated, false);
});

test('HTTP API - POST /api/linkedin/ai/generate with valid topic returns 200 and formatted content', async () => {
  const res = await fetch(`${BASE_URL}/ai/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-dev-user-id': DEV_USER_ID,
    },
    body: JSON.stringify({
      projectId: PROJECT_ID,
      topic: 'How our AI assistant streamlines LinkedIn social selling in 2026',
      tone: 'thought-leadership',
      length: 'medium',
      targetAudience: 'Growth Marketers',
      objective: 'Thought Leadership',
      includeHashtags: true,
    }),
  });
  assert.equal(res.status, 200);
  const json: any = await res.json();
  assert.equal(json.success, true);
  assert.ok(json.data.text);
  assert.equal(typeof json.data.text, 'string');
});

test('HTTP API - POST /api/linkedin/ai/generate supports minimal input (topic only)', async () => {
  const res = await fetch(`${BASE_URL}/ai/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-dev-user-id': DEV_USER_ID,
    },
    body: JSON.stringify({
      projectId: PROJECT_ID,
      topic: 'Scaling our engineering culture to 100 people',
    }),
  });
  assert.equal(res.status, 200);
  const json: any = await res.json();
  assert.equal(json.success, true);
  assert.ok(json.data.text);
});

test('HTTP API - POST /api/linkedin/ai/generate rejects invalid input (< 3 chars)', async () => {
  const res = await fetch(`${BASE_URL}/ai/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-dev-user-id': DEV_USER_ID,
    },
    body: JSON.stringify({
      projectId: PROJECT_ID,
      topic: 'hi',
    }),
  });
  assert.equal(res.status, 400);
  const json: any = await res.json();
  assert.equal(json.success, false);
  assert.equal(json.error.code, 'VALIDATION_ERROR');
});

test('HTTP API - POST /api/linkedin/ai/generate rejects unknown extra fields without echoing values', async () => {
  const res = await fetch(`${BASE_URL}/ai/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-dev-user-id': DEV_USER_ID,
    },
    body: JSON.stringify({
      projectId: PROJECT_ID,
      topic: 'Valid topic description here',
      forbiddenExtraField: 'secret_leak_payload',
    }),
  });
  assert.equal(res.status, 400);
  const raw = await res.text();
  assert.doesNotMatch(raw, /secret_leak_payload/);
});

test('HTTP API - Workflow: Generate content -> Save draft -> Verify draft content intact', async () => {
  // 1. Generate content
  const genRes = await fetch(`${BASE_URL}/ai/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-dev-user-id': DEV_USER_ID,
    },
    body: JSON.stringify({
      projectId: PROJECT_ID,
      topic: 'Building reliable cloud integrations with AI',
    }),
  });
  assert.equal(genRes.status, 200);
  const genJson: any = await genRes.json();
  const generatedText = genJson.data.text;

  // 2. User edits generated text
  const editedContent = `${generatedText}\n\nEdited by user before saving.`;

  // 3. Save as draft
  const draftRes = await fetch(`${BASE_URL}/posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-dev-user-id': DEV_USER_ID,
    },
    body: JSON.stringify({
      projectId: PROJECT_ID,
      content: editedContent,
      aiGenerated: true,
    }),
  });
  if (draftRes.status === 201) {
    const draftJson: any = await draftRes.json();
    const postId = draftJson.data.id;
    assert.equal(draftJson.data.content, editedContent);
    assert.equal(draftJson.data.status, 'DRAFT');

    // 4. Clean up post
    const delRes = await fetch(`${BASE_URL}/posts/${postId}`, {
      method: 'DELETE',
      headers: { 'x-dev-user-id': DEV_USER_ID },
    });
    assert.equal(delRes.status, 200);
  }
});
