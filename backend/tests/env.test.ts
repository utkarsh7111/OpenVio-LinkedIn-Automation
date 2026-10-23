import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from '../src/config/env.js';

const KEY = 'a'.repeat(64);
const prod: Record<string, string> = { NODE_ENV: 'production', LINKEDIN_MODE: 'live', LINKEDIN_CLIENT_ID: 'id', LINKEDIN_CLIENT_SECRET: 's', LINKEDIN_REDIRECT_URI: 'https://api.example.com/api/linkedin/callback', LINKEDIN_API_BASE: 'https://api.linkedin.com', TOKEN_ENCRYPTION_KEY: KEY, DATABASE_URL: 'postgresql://u:p@db/x', FRONTEND_URL: 'https://app.example.com', PUBLIC_API_BASE_URL: 'https://api.example.com', AI_PROVIDER: 'mock' };

test('defaults load for local development', () => {
  const cfg = loadEnv({});
  assert.equal(cfg.linkedinMode, 'mock');
  assert.equal(cfg.linkedinClientId, 'mock-client-id');
  assert.equal(cfg.linkedinClientSecret, 'mock-client-secret');
  assert.equal(cfg.linkedinApiBase, 'http://127.0.0.1:4100');
  assert.equal(cfg.frontendUrl, 'http://localhost:3000');
});

test('FRONTEND_URL is normalized to a bare origin for CORS', () => {
  assert.equal(loadEnv({ FRONTEND_URL: 'http://localhost:3000/some/path/' }).frontendUrl, 'http://localhost:3000');
});

test('placeholder or malformed encryption keys are rejected', () => {
  assert.throws(() => loadEnv({ TOKEN_ENCRYPTION_KEY: 'replace-with-64-hex-characters' }), /64 hex/);
  assert.throws(() => loadEnv({ TOKEN_ENCRYPTION_KEY: 'abc123' }), /64 hex/);
  assert.equal(loadEnv({ TOKEN_ENCRYPTION_KEY: KEY }).tokenEncryptionKey, KEY);
});

test('live mode requires credentials and an encryption key', () => {
  assert.throws(() => loadEnv({ LINKEDIN_MODE: 'live' }), /TOKEN_ENCRYPTION_KEY/);
  assert.throws(() => loadEnv({ LINKEDIN_MODE: 'live', TOKEN_ENCRYPTION_KEY: KEY }), /LINKEDIN_CLIENT_ID/);
});

test('live mode refuses any API host other than api.linkedin.com (SSRF guard)', () => {
  assert.throws(() => loadEnv({ ...prod, NODE_ENV: 'development', LINKEDIN_API_BASE: 'http://169.254.169.254' }), /api\.linkedin\.com/);
  assert.throws(() => loadEnv({ ...prod, NODE_ENV: 'development', LINKEDIN_API_BASE: 'https://evil.example.com' }), /api\.linkedin\.com/);
});

test('production rules: no mock mode, https only, database required', () => {
  assert.doesNotThrow(() => loadEnv(prod));
  assert.throws(() => loadEnv({ ...prod, LINKEDIN_MODE: 'mock' }), /mock is not allowed/);
  assert.throws(() => loadEnv({ ...prod, FRONTEND_URL: 'http://app.example.com' }), /https/);
  assert.throws(() => loadEnv({ ...prod, LINKEDIN_REDIRECT_URI: 'http://api.example.com/cb' }), /https/);
  assert.throws(() => loadEnv({ ...prod, DATABASE_URL: '' }), /DATABASE_URL/);
});

test('numeric settings are bounded', () => {
  assert.throws(() => loadEnv({ PORT: '99999' }), /PORT/);
  assert.throws(() => loadEnv({ PORT: 'abc' }), /PORT/);
  assert.throws(() => loadEnv({ SCHEDULER_INTERVAL_SECONDS: '0' }), /SCHEDULER/);
  assert.throws(() => loadEnv({ LINKEDIN_API_VERSION: 'latest' }), /YYYYMM/);
});

test('section 5 settings use documented defaults and enforce numeric/url bounds', () => {
  const cfg = loadEnv({});
  assert.equal(cfg.missedWindowHours, 6);
  assert.equal(cfg.stuckPublishingMinutes, 10);
  assert.equal(cfg.mediaMaxBytes, 5_242_880);
  assert.equal(cfg.uploadDir, './uploads');
  assert.equal(cfg.publicApiBaseUrl, 'http://localhost:4000');
  assert.equal(cfg.schedulerBatchSize, 20);
  assert.equal(cfg.linkedinHttpTimeoutMs, 10_000);
  assert.equal(cfg.tokenExpiryWarningDays, 7);
  assert.throws(() => loadEnv({ MISSED_WINDOW_HOURS: '0' }), /MISSED_WINDOW_HOURS/);
  assert.throws(() => loadEnv({ MISSED_WINDOW_HOURS: '169' }), /MISSED_WINDOW_HOURS/);
  assert.throws(() => loadEnv({ STUCK_PUBLISHING_MINUTES: '0' }), /STUCK_PUBLISHING_MINUTES/);
  assert.throws(() => loadEnv({ MEDIA_MAX_BYTES: '-1' }), /MEDIA_MAX_BYTES/);
  assert.throws(() => loadEnv({ SCHEDULER_BATCH_SIZE: '501' }), /SCHEDULER_BATCH_SIZE/);
  assert.throws(() => loadEnv({ LINKEDIN_HTTP_TIMEOUT_MS: '120001' }), /LINKEDIN_HTTP_TIMEOUT_MS/);
  assert.throws(() => loadEnv({ TOKEN_EXPIRY_WARNING_DAYS: '366' }), /TOKEN_EXPIRY_WARNING_DAYS/);
  assert.throws(() => loadEnv({ PUBLIC_API_BASE_URL: 'file:///tmp/uploads' }), /http or https/);
  assert.throws(() => loadEnv({ ...prod, PUBLIC_API_BASE_URL: 'http://api.example.com' }), /https/);
});
