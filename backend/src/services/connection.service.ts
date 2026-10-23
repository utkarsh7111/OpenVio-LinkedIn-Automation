import { env, type EnvConfig } from '../config/env.js';
import { connectionData, type ConnectionData } from '../db/connection.data.js';
import { decryptToken, encryptToken, generateOAuthState, hashOAuthState } from '../utils/crypto.js';
import { personUrn } from '../utils/urn.js';

export const CONNECTION_REASONS = Object.freeze([
  'ACCESS_DENIED',
  'INVALID_STATE',
  'EXPIRED_STATE',
  'EXCHANGE_FAILED',
  'PROFILE_FAILED',
  'NOT_ALLOWED',
  'SERVER_ERROR',
] as const);

export type ConnectionReason = typeof CONNECTION_REASONS[number];

export interface BeginConnectionOptions {
  projectId: string;
  userId: string;
}

export interface CallbackConnectionOptions {
  code?: string;
  state?: string;
  error?: string;
}

export interface ConnectionStatusResult {
  status: string;
  displayName: string | null;
  pictureUrl: string | null;
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  expiringSoon: boolean;
  scopes: string[];
}

export interface ConnectionService {
  begin(options: BeginConnectionOptions): Promise<{ authorizationUrl: string }>;
  callback(options: CallbackConnectionOptions): Promise<{ connected?: boolean; reason?: ConnectionReason }>;
  get(projectId: string): Promise<ConnectionStatusResult>;
  disconnect(projectId: string): Promise<{ status: string }>;
}

export interface CreateConnectionServiceOptions {
  data?: ConnectionData | any;
  config?: EnvConfig;
  fetchImpl?: typeof fetch;
  clock?: () => Date;
  encryptionKey?: string;
  logger?: { warn?: (...args: any[]) => void };
}

/** Connection workflows; OpenVio replaces project/user identity through adapters, never LinkedIn data access. */
export function createConnectionService({
  data = connectionData,
  config = env,
  fetchImpl = fetch,
  clock = () => new Date(),
  encryptionKey = config?.tokenEncryptionKey,
  logger = console,
}: CreateConnectionServiceOptions = {}): ConnectionService {
  const timeout = () => AbortSignal.timeout(config.linkedinHttpTimeoutMs);
  const api = (path: string) => new URL(path, config.linkedinApiBase);
  const oauth = (path: string) => new URL(path, config.linkedinOAuthBase ?? config.linkedinApiBase);
  const safeLog = (event: string, projectId: string) => logger.warn?.(JSON.stringify({ event, projectId }));

  // Profile data comes from a third party and is later rendered by the browser: accept only a plain https
  // image URL on LinkedIn's CDN (any http/https host only in mock mode) and a bounded display name.
  function safePictureUrl(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > 2000) return null;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    const host = url.hostname.toLowerCase();
    if (config.linkedinMode === 'live') {
      return url.protocol === 'https:' && (host.endsWith('.licdn.com') || host.endsWith('.linkedin.com')) ? url.toString() : null;
    }
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  }
  const safeName = (value: unknown): string | null =>
    typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || null : null;

  async function json(response: Response): Promise<any> {
    if (!response.ok) throw new Error('provider');
    return response.json();
  }
  async function exchange(code: string): Promise<any> {
    const response = await fetchImpl(oauth('/oauth/v2/accessToken'), {
      method: 'POST',
      signal: timeout(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.linkedinRedirectUri,
        client_id: config.linkedinClientId,
        client_secret: config.linkedinClientSecret,
      }),
    });
    const token = await json(response);
    if (typeof token.access_token !== 'string' || !Number.isFinite(Number(token.expires_in)) || Number(token.expires_in) <= 0) {
      throw new Error('provider');
    }
    return token;
  }
  async function profile(accessToken: string): Promise<any> {
    const response = await fetchImpl(api('/v2/userinfo'), {
      signal: timeout(),
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const value = await json(response);
    if (typeof value.sub !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value.sub)) throw new Error('provider');
    return value;
  }

  return Object.freeze({
    async begin({ projectId, userId }: BeginConnectionOptions) {
      await data.deleteExpiredOAuthStates();
      const state = generateOAuthState();
      await data.createOAuthState({
        stateHash: hashOAuthState(state),
        userId,
        projectId,
        expiresAt: new Date(clock().getTime() + 600_000).toISOString(),
      });
      const url = oauth('/oauth/v2/authorization');
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: config.linkedinClientId,
        redirect_uri: config.linkedinRedirectUri,
        state,
        scope: 'openid profile w_member_social',
      }).toString();
      return { authorizationUrl: url.toString() };
    },
    async callback({ code, state, error }: CallbackConnectionOptions) {
      if (typeof state !== 'string' || !state) return { reason: 'INVALID_STATE' as const };
      const consumed = await data.consumeOAuthState(hashOAuthState(state));
      if (!consumed) return { reason: 'INVALID_STATE' as const };
      if (consumed.status === 'expired') return { reason: 'EXPIRED_STATE' as const };
      if (consumed.status !== 'consumed') return { reason: error ? ('ACCESS_DENIED' as const) : ('INVALID_STATE' as const) };
      if (error) return { reason: 'ACCESS_DENIED' as const };
      if (typeof code !== 'string' || !code) return { reason: 'INVALID_STATE' as const };
      if (data.isAllowed && !(await data.isAllowed(consumed.project_id, consumed.user_id))) {
        return { reason: 'NOT_ALLOWED' as const };
      }

      let token: any;
      try {
        token = await exchange(code);
      } catch {
        return { reason: 'EXCHANGE_FAILED' as const };
      }
      let user: any;
      try {
        user = await profile(token.access_token);
      } catch {
        return { reason: 'PROFILE_FAILED' as const };
      }
      try {
        const expiresAt = new Date(clock().getTime() + Number(token.expires_in) * 1000).toISOString();
        const refreshExpiresAt = token.refresh_token_expires_in
          ? new Date(clock().getTime() + Number(token.refresh_token_expires_in) * 1000).toISOString()
          : null;
        const scopes = typeof token.scope === 'string' ? token.scope.split(/\s+/).filter(Boolean) : [];
        await data.connect({
          projectId: consumed.project_id,
          userId: consumed.user_id,
          memberId: user.sub,
          authorUrn: personUrn(user.sub),
          displayName: safeName(user.name),
          pictureUrl: safePictureUrl(user.picture),
          accessTokenEncrypted: encryptToken(token.access_token, encryptionKey),
          refreshTokenEncrypted: token.refresh_token ? encryptToken(token.refresh_token, encryptionKey) : null,
          expiresAt,
          refreshExpiresAt,
          scopes,
        });
        return { connected: true };
      } catch {
        return { reason: 'SERVER_ERROR' as const };
      }
    },
    async get(projectId: string): Promise<ConnectionStatusResult> {
      const row = await data.getConnection(projectId);
      if (!row) {
        return {
          status: 'NOT_CONNECTED',
          displayName: null,
          pictureUrl: null,
          expiresAt: null,
          daysUntilExpiry: null,
          expiringSoon: false,
          scopes: [],
        };
      }
      const expiry = row.access_token_expires_at ? new Date(row.access_token_expires_at).getTime() : null;
      let status = row.status;
      if (status === 'ACTIVE' && expiry !== null && expiry <= clock().getTime()) {
        await data.setExpired(row.id);
        status = 'EXPIRED';
      }
      const daysUntilExpiry = expiry === null ? null : Math.ceil((expiry - clock().getTime()) / 86_400_000);
      return {
        status,
        displayName: row.display_name ?? null,
        pictureUrl: row.profile_picture_url ?? null,
        expiresAt: row.access_token_expires_at ? new Date(row.access_token_expires_at).toISOString() : null,
        daysUntilExpiry,
        expiringSoon: status === 'ACTIVE' && daysUntilExpiry !== null && daysUntilExpiry <= config.tokenExpiryWarningDays,
        scopes: row.scopes ?? [],
      };
    },
    async disconnect(projectId: string) {
      const row = await data.getActiveConnectionForDisconnect(projectId);
      if (!row) return { status: 'NOT_CONNECTED' };
      try {
        const token = decryptToken(row.access_token_encrypted, encryptionKey);
        const response = await fetchImpl(oauth('/oauth/v2/revoke'), {
          method: 'POST',
          signal: timeout(),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: config.linkedinClientId,
            client_secret: config.linkedinClientSecret,
            token,
          }),
        });
        if (!response.ok) safeLog('linkedin_revoke_failed', projectId);
      } catch {
        safeLog('linkedin_revoke_failed', projectId);
      }
      await data.disconnect(projectId);
      return { status: 'NOT_CONNECTED' };
    },
  });
}

export const connectionService = createConnectionService();
