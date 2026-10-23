import pg from 'pg';
import { env } from '../config/env.js';
import { buildPoolConfig } from './poolConfig.js';

const { Pool } = pg;
export const pool = new Pool(buildPoolConfig(env));
pool.on('error', (error) => console.error(JSON.stringify({ event: 'postgres_idle_client_error', errorType: error?.name ?? 'Error' })));

export async function checkDatabase(): Promise<boolean> {
  await pool.query('SELECT 1');
  return true;
}
