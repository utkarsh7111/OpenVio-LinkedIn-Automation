import test from 'node:test';
import assert from 'node:assert/strict';
import { requestLogger } from '../src/middleware/requestLogger.js';

test('request logs contain neither query parameters nor OAuth code/state values', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalLog = console.log;
  const lines: string[] = [];
  process.env.NODE_ENV = 'development';
  console.log = (line: any) => lines.push(String(line));
  try {
    let finish!: () => void;
    const response: any = { setHeader() {}, on(event: string, callback: () => void) { if (event === 'finish') finish = callback; }, statusCode: 302 };
    const request: any = { method: 'GET', path: '/api/linkedin/callback', originalUrl: '/api/linkedin/callback?code=TEST-CODE-SHOULD-NOT-LOG&state=TEST-STATE-SHOULD-NOT-LOG' };
    requestLogger(request, response, () => {});
    finish();
  } finally {
    console.log = originalLog;
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /"path":"\/api\/linkedin\/callback"/);
  assert.doesNotMatch(lines[0], /TEST-CODE|TEST-STATE|code=|state=/);
});
