import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// .env.example lives at the repo root, so load the root .env (cwd-independent).
// Real environment variables always win over the file.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });
dotenv.config({ path: path.resolve(process.cwd(), '../.env'), quiet: true });

const KEY_PATTERN = /^[0-9a-fA-F]{64}$/;
const PLACEHOLDER_KEY = /replace-with/i;

function positiveInt(name: string, value: unknown, fallback: number, max: number = 1_000_000): number {
  const raw = typeof value === 'string' && value.trim() === '' ? undefined : value;
  const parsed = Number(raw ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
  return parsed;
}

function nonNegativeInt(name: string, value: unknown, fallback: number, max: number = 10): number {
  const raw = typeof value === 'string' && value.trim() === '' ? undefined : value;
  const parsed = Number(raw ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw new Error(`${name} must be an integer between 0 and ${max}`);
  }
  return parsed;
}

function boundedInt(name: string, value: unknown, fallback: number, min: number, max: number): number {
  const raw = typeof value === 'string' && value.trim() === '' ? undefined : value;
  const parsed = Number(raw ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function parseUrl(name: string, value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

export interface EnvConfig {
  readonly nodeEnv: 'development' | 'test' | 'production' | string;
  readonly isProduction: boolean;
  readonly port: number;
  readonly frontendUrl: string;
  readonly trustProxyHops: number;
  readonly databaseUrl: string;
  readonly databaseSslCaFile: string;
  readonly dbPoolMax: number;
  readonly linkedinMode: 'mock' | 'live' | string;
  readonly linkedinClientId: string;
  readonly linkedinClientSecret: string;
  readonly linkedinRedirectUri: string;
  readonly linkedinApiVersion: string;
  readonly linkedinApiBase: string;
  readonly linkedinOAuthBase: string;
  readonly tokenEncryptionKey: string;
  readonly tokenKeyEphemeral: boolean;
  readonly schedulerIntervalSeconds: number;
  readonly aiProvider: 'mock' | 'openai' | 'gemini' | string;
  readonly aiApiKey: string;
  readonly geminiApiKey: string;
  readonly geminiModel: string;
  readonly allowDestructiveMigrations: boolean;
  readonly missedWindowHours: number;
  readonly stuckPublishingMinutes: number;
  readonly mediaMaxBytes: number;
  readonly uploadDir: string;
  readonly publicApiBaseUrl: string;
  readonly schedulerBatchSize: number;
  readonly linkedinHttpTimeoutMs: number;
  readonly tokenExpiryWarningDays: number;
  readonly devAuthEnabled: boolean;
}

/** Pure and testable: validates a raw environment object and returns frozen config. */
export function loadEnv(source: Record<string, string | undefined> = process.env): EnvConfig {
  const nodeEnv = source.NODE_ENV ?? 'development';
  const rawLinkedinMode = (source.LINKEDIN_MODE ?? 'mock').trim().toLowerCase();
  const linkedinMode = (rawLinkedinMode === 'real' || rawLinkedinMode === 'live') ? 'live' : rawLinkedinMode;
  const geminiApiKey = source.GEMINI_API_KEY ?? '';
  const geminiModel = source.GEMINI_MODEL || 'gemini-3.8-flash';
  const aiProvider = source.AI_PROVIDER ?? (geminiApiKey ? 'gemini' : 'mock');
  const isProduction = nodeEnv === 'production';

  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('NODE_ENV must be development, test, or production');
  if (!['mock', 'live'].includes(linkedinMode)) throw new Error('LINKEDIN_MODE must be mock, live, or real');
  if (!['mock', 'openai', 'gemini'].includes(aiProvider)) throw new Error('AI_PROVIDER must be mock, openai, or gemini');

  // CORS needs a bare origin; strip any path or trailing slash the operator typed.
  const frontendUrl = parseUrl('FRONTEND_URL', source.FRONTEND_URL ?? 'http://localhost:3000');
  if (!['http:', 'https:'].includes(frontendUrl.protocol)) throw new Error('FRONTEND_URL must use http or https');
  const frontendOrigin = frontendUrl.origin;

  const redirectUri = parseUrl('LINKEDIN_REDIRECT_URI', source.LINKEDIN_REDIRECT_URI ?? 'http://localhost:4000/api/linkedin/callback');
  const apiBase = parseUrl('LINKEDIN_API_BASE', source.LINKEDIN_API_BASE ?? (linkedinMode === 'mock' ? 'http://127.0.0.1:4100' : 'https://api.linkedin.com'));
  const apiVersion = source.LINKEDIN_API_VERSION ?? '202610';
  if (!/^\d{6}$/.test(apiVersion)) throw new Error('LINKEDIN_API_VERSION must be YYYYMM, for example 202610');

  // Token encryption key: always validated when present, required whenever tokens can exist.
  const tokenKey = source.TOKEN_ENCRYPTION_KEY ?? '';
  const tokensPossible = linkedinMode === 'live' || isProduction;
  if (tokenKey && (PLACEHOLDER_KEY.test(tokenKey) || !KEY_PATTERN.test(tokenKey))) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 64 hex characters. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  if (!tokenKey && tokensPossible) throw new Error('TOKEN_ENCRYPTION_KEY is required in production or when LINKEDIN_MODE=live');
  // Local mock work: without any key the OAuth callback cannot encrypt tokens and fails with SERVER_ERROR.
  // Use a random in-memory key instead. Tokens stored with it become unreadable after a restart, which
  // the app already handles as RECONNECT_REQUIRED. This can never happen in production or live mode (above).
  const tokenKeyEphemeral = !tokenKey;
  const effectiveTokenKey = tokenKey || randomBytes(32).toString('hex');
  if (tokenKeyEphemeral && nodeEnv === 'development') console.warn('TOKEN_ENCRYPTION_KEY is not set: using a temporary key for this run. LinkedIn connections will need reconnecting after a restart.');

  if (linkedinMode === 'live') {
    for (const key of ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_REDIRECT_URI']) {
      if (!source[key]) throw new Error(`${key} is required when LINKEDIN_MODE=live`);
    }
    // SSRF guard: bearer tokens must only ever be sent to LinkedIn over TLS.
    if (apiBase.protocol !== 'https:' || apiBase.hostname !== 'api.linkedin.com') {
      throw new Error('LINKEDIN_API_BASE must be https://api.linkedin.com when LINKEDIN_MODE=live');
    }
  }
  if (isProduction) {
    if (linkedinMode === 'mock') throw new Error('LINKEDIN_MODE=mock is not allowed in production');
    if (!source.DATABASE_URL) throw new Error('DATABASE_URL is required in production');
    if (frontendUrl.protocol !== 'https:') throw new Error('FRONTEND_URL must use https in production');
    if (redirectUri.protocol !== 'https:') throw new Error('LINKEDIN_REDIRECT_URI must use https in production');
    if (aiProvider === 'mock') console.warn('AI_PROVIDER=mock is active in production');
  }
  if (aiProvider === 'openai' && !source.AI_API_KEY) throw new Error('AI_API_KEY is required when AI_PROVIDER=openai');

  const publicApiUrl = parseUrl('PUBLIC_API_BASE_URL', source.PUBLIC_API_BASE_URL ?? 'http://localhost:4000');
  if (!['http:', 'https:'].includes(publicApiUrl.protocol)) throw new Error('PUBLIC_API_BASE_URL must use http or https');
  if (isProduction && publicApiUrl.protocol !== 'https:') throw new Error('PUBLIC_API_BASE_URL must use https in production');

  return Object.freeze({
    nodeEnv,
    isProduction,
    port: positiveInt('PORT', source.PORT, 4000, 65535),
    frontendUrl: frontendOrigin,
    trustProxyHops: nonNegativeInt('TRUST_PROXY', source.TRUST_PROXY, 0),
    databaseUrl: source.DATABASE_URL ?? '',
    databaseSslCaFile: source.DATABASE_SSL_CA_FILE ?? '',
    dbPoolMax: positiveInt('DB_POOL_MAX', source.DB_POOL_MAX, 10, 100),
    linkedinMode,
    linkedinClientId: source.LINKEDIN_CLIENT_ID || (linkedinMode === 'mock' ? 'mock-client-id' : ''),
    linkedinClientSecret: source.LINKEDIN_CLIENT_SECRET || (linkedinMode === 'mock' ? 'mock-client-secret' : ''),
    linkedinRedirectUri: redirectUri.toString(),
    linkedinApiVersion: apiVersion,
    linkedinApiBase: apiBase.origin,
    // OAuth endpoints share the mock origin; live OAuth is hosted on www.linkedin.com.
    linkedinOAuthBase: linkedinMode === 'mock' ? apiBase.origin : 'https://www.linkedin.com',
    tokenEncryptionKey: effectiveTokenKey,
    tokenKeyEphemeral,
    schedulerIntervalSeconds: positiveInt('SCHEDULER_INTERVAL_SECONDS', source.SCHEDULER_INTERVAL_SECONDS, 60, 86_400),
    aiProvider,
    aiApiKey: source.AI_API_KEY ?? '',
    geminiApiKey,
    geminiModel,
    allowDestructiveMigrations: source.ALLOW_DESTRUCTIVE_MIGRATIONS === 'true',
    missedWindowHours: boundedInt('MISSED_WINDOW_HOURS', source.MISSED_WINDOW_HOURS, 6, 1, 168),
    stuckPublishingMinutes: positiveInt('STUCK_PUBLISHING_MINUTES', source.STUCK_PUBLISHING_MINUTES, 10, 10_080),
    mediaMaxBytes: positiveInt('MEDIA_MAX_BYTES', source.MEDIA_MAX_BYTES, 5_242_880, 52_428_800),
    uploadDir: source.UPLOAD_DIR ?? './uploads',
    publicApiBaseUrl: publicApiUrl.origin,
    schedulerBatchSize: positiveInt('SCHEDULER_BATCH_SIZE', source.SCHEDULER_BATCH_SIZE, 20, 500),
    linkedinHttpTimeoutMs: positiveInt('LINKEDIN_HTTP_TIMEOUT_MS', source.LINKEDIN_HTTP_TIMEOUT_MS, 10_000, 120_000),
    tokenExpiryWarningDays: positiveInt('TOKEN_EXPIRY_WARNING_DAYS', source.TOKEN_EXPIRY_WARNING_DAYS, 7, 365),
    // Header-based dev identity (x-dev-user-id) must be switched on explicitly, and is never available in
    // production. Without this opt-in a server started with NODE_ENV unset would let anyone act as any seeded user.
    devAuthEnabled: !isProduction && (source.DEV_AUTH_ENABLED === 'true' || nodeEnv === 'test'),
  });
}

export const env = loadEnv(process.env);
