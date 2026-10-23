import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { pool } from './pool.js';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');
const direction = process.argv[2] ?? 'up';
const FILE_PATTERN = /^\d{3}_[a-z0-9_]+\.(up|down)\.sql$/;
const LOCK_ID = 727_001; // advisory lock so two runners can never migrate at once

async function main(): Promise<void> {
  // Validate before touching the database.
  if (!['up', 'down'].includes(direction)) throw new Error('Usage: npm run migrate [up|down]');
  if (direction === 'down' && env.isProduction && !env.allowDestructiveMigrations) {
    throw new Error('Refusing to run a down migration in production. Set ALLOW_DESTRUCTIVE_MIGRATIONS=true only if you intend to destroy data.');
  }

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const applied = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((row: any) => row.name));

    const all = (await fs.readdir(migrationsDir)).filter((file) => FILE_PATTERN.test(file)).sort();
    const ups = all.filter((file) => file.endsWith('.up.sql'));
    for (const up of ups) {
      if (!all.includes(up.replace('.up.sql', '.down.sql'))) throw new Error(`Missing down migration for ${up}`);
    }
    const candidates = direction === 'up'
      ? ups.filter((file) => !applied.has(file))
      : ups.filter((file) => applied.has(file)).reverse().slice(0, 1).map((file) => file.replace('.up.sql', '.down.sql'));

    for (const file of candidates) {
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      const upName = file.replace('.down.sql', '.up.sql');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        if (direction === 'up') await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
        else await client.query('DELETE FROM schema_migrations WHERE name = $1', [upName]);
        await client.query('COMMIT');
        console.log(`${direction}: ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    if (!candidates.length) console.log(`No ${direction} migrations to apply`);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

try {
  await main();
} catch (error: any) {
  console.error(JSON.stringify({ event: 'migration_failed', errorType: error?.name ?? 'Error', message: error?.message, code: error?.code }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
