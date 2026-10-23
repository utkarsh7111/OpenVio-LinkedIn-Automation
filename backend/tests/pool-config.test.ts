import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPoolConfig } from '../src/db/poolConfig.js';

const base: any = { dbPoolMax: 10, databaseSslCaFile: '' };
const AIVEN = 'postgres://avnadmin:p%40ss@pg-x.aivencloud.com:10895/defaultdb?sslmode=require';

test('local database without TLS keeps a plain connection string', () => {
  const config = buildPoolConfig({ ...base, databaseUrl: 'postgresql://u:p@localhost:5432/db' });
  assert.equal(config.ssl, undefined);
  assert.equal(config.connectionString, 'postgresql://u:p@localhost:5432/db');
});

test('sslmode in the URL becomes explicit TLS with certificate verification ON', () => {
  const config = buildPoolConfig({ ...base, databaseUrl: AIVEN });
  assert.equal((config.ssl as any).rejectUnauthorized, true);
  assert.doesNotMatch(config.connectionString!, /sslmode/);
  assert.match(config.connectionString!, /p%40ss@pg-x\.aivencloud\.com:10895\/defaultdb/);
});

test('the provider CA file is trusted, never replaced by disabling verification', () => {
  const config = buildPoolConfig({ ...base, databaseUrl: AIVEN, databaseSslCaFile: 'certs/ca.pem' }, () => '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----');
  assert.match((config.ssl as any).ca, /BEGIN CERTIFICATE/);
  assert.equal((config.ssl as any).rejectUnauthorized, true);
});

test('a missing CA file fails with a clear message that does not leak the connection string', () => {
  assert.throws(() => buildPoolConfig({ ...base, databaseUrl: AIVEN, databaseSslCaFile: 'certs/missing.pem' }, () => { throw new Error('ENOENT'); }), (error: any) => /DATABASE_SSL_CA_FILE could not be read/.test(error.message) && !/avnadmin|p%40ss/.test(error.message));
});

test('sslmode=disable stays unencrypted', () => {
  assert.equal(buildPoolConfig({ ...base, databaseUrl: 'postgres://u:p@localhost/db?sslmode=disable' }).ssl, undefined);
});
