import { env } from '../config/env.js';
import { pool } from './pool.js';

// Demo identities and fixed IDs are for local development and tests only.
if (env.isProduction) {
  console.error('Refusing to seed demo users in production.');
  process.exit(1);
}

let client: any;
try {
  client = await pool.connect();
  await client.query('BEGIN');
  const project = await client.query(`INSERT INTO projects(id, name) VALUES ('00000000-0000-4000-8000-000000000001', 'OpenVio Demo') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name RETURNING id`);
  // [id, name, role, hasLinkedInModuleAccess]. The viewer deliberately has NO module access,
  // so permission-denial paths can be tested.
  const users: [string, string, string, boolean][] = [
    ['00000000-0000-4000-8000-000000000011', 'Demo Admin', 'ADMIN', true],
    ['00000000-0000-4000-8000-000000000012', 'Demo Editor', 'EDITOR', true],
    ['00000000-0000-4000-8000-000000000013', 'Demo Viewer', 'VIEWER', false],
  ];
  for (const [id, name, role, access] of users) {
    await client.query(`INSERT INTO dev_users(id, name, role) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role`, [id, name, role]);
    await client.query(`INSERT INTO project_members(project_id, user_id, role, linkedin_module_access) VALUES ($1, $2, $3, $4) ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role, linkedin_module_access = EXCLUDED.linkedin_module_access`, [project.rows[0].id, id, role, access]);
  }
  await client.query('COMMIT');
  console.log('Development project and demo users seeded (no credentials or tokens created).');
} catch (error: any) {
  if (client) await client.query('ROLLBACK').catch(() => {});
  console.error(JSON.stringify({ event: 'seed_failed', errorType: error?.name ?? 'Error' }));
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
