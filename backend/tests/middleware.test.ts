import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { validate } from '../src/middleware/validate.js';
import { requireAuth, requireProjectAccess, requireRole, requireRecordProject } from '../src/middleware/auth.js';

function response() {
  return { statusCode: 200, body: null as any, status(code: number) { this.statusCode = code; return this; }, json(body: any) { this.body = body; return this; } };
}
async function invoke(middleware: any, request: any) {
  const res = response(); let nextError: any;
  await middleware(request, res, (error: any) => { nextError = error; });
  if (nextError) throw nextError;
  return res;
}

test('strict Zod validation rejects unknown field names without echoing values', async () => {
  const schema = z.strictObject({ content: z.string().min(1) });
  const req = { body: { content: '', secretExtra: 'must-not-leak' } };
  const res = await invoke(validate(schema), req);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body.error.fields.sort(), ['content', 'secretExtra']);
  assert.doesNotMatch(JSON.stringify(res.body), /must-not-leak/);
  const accepted = await invoke(validate(schema), { body: { content: 'ok' } });
  assert.equal(accepted.statusCode, 200);
});

test('requireAuth accepts a verified user and rejects an anonymous request', async () => {
  const auth = { authenticate: async (req: any) => req.identity ?? null };
  const good = await invoke(requireAuth(auth as any), { identity: { id: 'u1' } });
  assert.equal(good.statusCode, 200);
  const denied = await invoke(requireAuth(auth as any), {});
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.body.error.code, 'UNAUTHENTICATED');
});

test('ADMIN and EDITOR may perform writes; VIEWER is denied writes but can pass read role checks', async () => {
  for (const role of ['ADMIN', 'EDITOR']) {
    const result = await invoke(requireRole('ADMIN', 'EDITOR'), { project: { role } });
    assert.equal(result.statusCode, 200, role);
  }
  assert.equal((await invoke(requireRole('ADMIN', 'EDITOR'), { project: { role: 'VIEWER' } })).statusCode, 403);
  assert.equal((await invoke(requireRole('ADMIN', 'EDITOR', 'VIEWER'), { project: { role: 'VIEWER' } })).statusCode, 200);
});

test('project access distinguishes unknown projects, missing membership, and disabled module access', async () => {
  const known = '11111111-1111-4111-8111-111111111111';
  const projects = {
    getProject: async (id: string) => id === known ? { id } : null,
    getMembership: async (_projectId: string, userId: string) => userId === 'member' ? { role: 'ADMIN', linkedin_module_access: true } : userId === 'noaccess' ? { role: 'EDITOR', linkedin_module_access: false } : null,
  };
  const call = (userId: string, projectId = known) => invoke(requireProjectAccess({ projects: projects as any }), { user: { id: userId }, query: { projectId }, params: {}, body: {} });
  const good = await call('member');
  assert.equal(good.statusCode, 200);
  assert.equal(good.body, null);
  assert.equal((await call('missing')).body.error.code, 'FORBIDDEN');
  assert.equal((await call('noaccess')).body.error.code, 'FORBIDDEN');
  assert.equal((await call('member', '22222222-2222-4222-8222-222222222222')).statusCode, 404);
});

test('record owned by another project is indistinguishable from missing', async () => {
  const middleware = requireRecordProject(async () => '22222222-2222-4222-8222-222222222222');
  const res = await invoke(middleware, { project: { id: '11111111-1111-4111-8111-111111111111' } });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});
