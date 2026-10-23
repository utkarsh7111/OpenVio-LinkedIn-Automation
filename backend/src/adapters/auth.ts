import type { Request } from 'express';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';

export interface DevUser {
  id: string;
  name: string;
}

export interface AuthAdapter {
  authenticate(request: Request | any): Promise<DevUser | null>;
}

export interface CreateAuthAdapterOptions {
  verifyIdentity?: (request: Request | any) => Promise<DevUser | null>;
  isProduction?: boolean;
  devAuthEnabled?: boolean;
  database?: any;
}

/** OpenVio replaces this development identity lookup with its session/token verifier. */
export function createAuthAdapter({
  verifyIdentity,
  isProduction = env.isProduction,
  devAuthEnabled = env.devAuthEnabled,
  database = pool,
}: CreateAuthAdapterOptions = {}): AuthAdapter {
  if (isProduction && typeof verifyIdentity !== 'function') {
    throw new Error('Production requires a configured OpenVio identity verifier');
  }
  if (!verifyIdentity && !devAuthEnabled && env.nodeEnv === 'development') {
    console.warn('Development identity is disabled, so every request will get 401. Set DEV_AUTH_ENABLED=true in .env for local development only.');
  }
  return Object.freeze({
    async authenticate(request: Request | any): Promise<DevUser | null> {
      if (verifyIdentity) return verifyIdentity(request);
      if (!devAuthEnabled) return null; // fail closed: dev headers are never trusted unless explicitly enabled
      const userId = request.get?.('x-dev-user-id') ?? request.headers?.['x-dev-user-id'];
      if (typeof userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) return null;
      const { rows } = await database.query('SELECT id, name FROM dev_users WHERE id = $1', [userId]);
      return rows[0] ?? null;
    },
  });
}

// Importing the adapter in production without an injected verifier fails closed.
export const authAdapter = createAuthAdapter();
