import test from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';
import express from 'express';
import { createHealthRouter } from '../src/routes/health.routes.js';

async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const server = app.listen(0);
  try {
    const address = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
  }
}

test('GET /health returns the documented envelope without database details', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, data: { status: 'ok' }, error: null });
  });
});

test('readiness returns 200 only when the database check succeeds and hides failures', async () => {
  const readyApp = express();
  readyApp.use('/health', createHealthRouter(async () => {}));
  const readyServer = readyApp.listen(0);
  try {
    const address = readyServer.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/health/ready`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, data: { status: 'ready' }, error: null });
  } finally { readyServer.close(); }
  const unavailableApp = express();
  unavailableApp.use('/health', createHealthRouter(async () => { throw new Error('database password must not leak'); }));
  const server = unavailableApp.listen(0);
  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/health/ready`);
    assert.equal(response.status, 503);
    const body: any = await response.json();
    assert.deepEqual(body, { success: false, data: null, error: { code: 'NOT_READY', message: 'The service is not ready.' } });
    assert.doesNotMatch(JSON.stringify(body), /password|database/);
  } finally { server.close(); }
});

test('unknown routes return the documented error envelope', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/missing`);
    assert.equal(response.status, 404);
    assert.equal(((await response.json()) as any).error.code, 'NOT_FOUND');
  });
});

test('security headers are present and the framework is not advertised', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(response.headers.get('x-request-id'));
    assert.ok(response.headers.get('strict-transport-security'));
  });
});

test('CORS allows only the configured frontend origin', async () => {
  await withServer(async (base) => {
    const allowed = await fetch(`${base}/health`, { headers: { Origin: env.frontendUrl } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), env.frontendUrl);
    const denied = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.example.com' } });
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  });
});

test('malformed JSON returns a generic 400 with no parser internals', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/anything`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"broken":' });
    assert.equal(response.status, 400);
    const body: any = await response.json();
    assert.equal(body.error.code, 'INVALID_JSON');
    assert.doesNotMatch(JSON.stringify(body), /Unexpected|position|at /);
  });
});

test('oversized bodies are rejected with 413', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/anything`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(300 * 1024) }) });
    assert.equal(response.status, 413);
    assert.equal(((await response.json()) as any).error.code, 'PAYLOAD_TOO_LARGE');
  });
});

test('the /api surface is rate limited', async () => {
  await withServer(async (base) => {
    let limited = 0;
    for (let i = 0; i < 130; i += 1) {
      const response = await fetch(`${base}/api/ping`);
      if (response.status === 429) { limited += 1; assert.equal(((await response.json()) as any).error.code, 'RATE_LIMITED'); }
    }
    assert.ok(limited > 0, 'expected at least one 429 after 130 rapid requests');
  });
});
