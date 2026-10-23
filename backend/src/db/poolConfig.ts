import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { EnvConfig } from '../config/env.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Builds node-postgres options. Hosted databases (Aiven, Neon, RDS...) need TLS, and most sign with their own
 * certificate authority. node-postgres lets `sslmode=` in the URL override explicit options, so the parameter is
 * removed from the URL and TLS is configured explicitly: certificate verification stays ON, and the provider's
 * CA file (DATABASE_SSL_CA_FILE) is trusted. Verification is never disabled.
 */
export function buildPoolConfig(env: EnvConfig, readFile: (file: string, encoding: 'utf8') => string = fs.readFileSync): pg.PoolConfig {
  const config: pg.PoolConfig = {
    max: env.dbPoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000, // a runaway query cannot hold a connection forever
    idle_in_transaction_session_timeout: 15_000,
    application_name: 'openvio-linkedin',
  };
  if (!env.databaseUrl) return config;

  const url = new URL(env.databaseUrl);
  const sslmode = url.searchParams.get('sslmode');
  url.searchParams.delete('sslmode');
  config.connectionString = url.toString();

  const wantsTls = (sslmode && sslmode !== 'disable') || Boolean(env.databaseSslCaFile);
  if (wantsTls) {
    const sslObj: { rejectUnauthorized: boolean; ca?: string } = { rejectUnauthorized: true };
    if (env.databaseSslCaFile) {
      const file = path.isAbsolute(env.databaseSslCaFile) ? env.databaseSslCaFile : path.resolve(repoRoot, env.databaseSslCaFile);
      try { sslObj.ca = readFile(file, 'utf8'); } catch { throw new Error(`DATABASE_SSL_CA_FILE could not be read: ${file}`); }
    }
    config.ssl = sslObj;
  }
  return config;
}
