import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptToken, decryptToken } from '../src/utils/crypto.js';
import { escapeCommentary } from '../src/utils/escapeCommentary.js';
import { isLinkedInUrn, personUrn, assertLinkedInUrn } from '../src/utils/urn.js';
import { toUtcIso, addMillisecondsUtc, isAtLeastMinutesAhead } from '../src/utils/time.js';
import { canTransition, POST_STATUS } from '../src/config/statuses.js';

test('AES-256-GCM token encryption round-trips and detects tampering and wrong keys', () => {
  const key = 'a'.repeat(64);
  const otherKey = 'b'.repeat(64);
  const encrypted = encryptToken('private-token', key);
  assert.equal(decryptToken(encrypted, key), 'private-token');
  const [iv, tag, ciphertext] = encrypted.split(':');
  const altered = `${iv}:${tag}:${Buffer.from(Array.from(Buffer.from(ciphertext, 'base64')).map((byte, i) => i ? byte : byte ^ 1)).toString('base64')}`;
  assert.throws(() => decryptToken(altered, key));
  assert.throws(() => decryptToken(encrypted, otherKey));
  assert.equal(encrypted.split(':').length, 3);
});

test('LinkedIn commentary markup characters are escaped without changing line breaks', () => {
  assert.equal(escapeCommentary('a_b *c* ~d~ `e` #f |x| \\g\nnext'), 'a\\_b \\*c\\* \\~d\\~ `e` \\#f \\|x\\| \\\\g\nnext');
  assert.equal(escapeCommentary('He said "hello" (really)'), 'He said "hello" \\(really\\)', 'double quotes are not reserved and must stay unescaped');
  for (const character of ['|', '{', '}', '@', '[', ']', '(', ')', '<', '>', '#', '\\', '*', '_', '~']) {
    assert.equal(escapeCommentary(character), `\\${character}`, `reserved character ${character}`);
  }
});

test('LinkedIn URN helpers validate types and build person URNs', () => {
  assert.equal(personUrn('abc-123'), 'urn:li:person:abc-123');
  assert.equal(isLinkedInUrn('urn:li:ugcPost:123'), true);
  assert.equal(isLinkedInUrn('urn:li:image:123', 'person'), false);
  assert.throws(() => assertLinkedInUrn('not-a-urn', 'person'), /Invalid LinkedIn/);
});

test('UTC helpers normalize, add durations, and compare future timestamps', () => {
  assert.equal(toUtcIso('2026-10-17T12:00:00+05:30'), '2026-10-17T06:30:00.000Z');
  assert.equal(toUtcIso('bad'), null);
  assert.equal(addMillisecondsUtc('2026-10-17T00:00:00Z', 60_000), '2026-10-17T00:01:00.000Z');
  assert.equal(isAtLeastMinutesAhead('2026-10-17T00:10:00Z', 5, new Date('2026-10-17T00:00:00Z')), true);
  assert.equal(isAtLeastMinutesAhead('invalid', 5, new Date('2026-10-17T00:00:00Z')), false);
});

test('every defined status transition is allowed and every other pair is forbidden', () => {
  const allowed = [
    ['DRAFT', 'SCHEDULED'], ['DRAFT', 'PUBLISHING'],
    ['SCHEDULED', 'DRAFT'], ['SCHEDULED', 'SCHEDULED'], ['SCHEDULED', 'PUBLISHING'],
    ['FAILED', 'DRAFT'], ['FAILED', 'SCHEDULED'], ['FAILED', 'PUBLISHING'],
    ['PUBLISHING', 'PUBLISHED'], ['PUBLISHING', 'FAILED'], ['PUBLISHING', 'SCHEDULED'],
  ];
  for (const from of Object.values(POST_STATUS)) {
    for (const to of Object.values(POST_STATUS)) assert.equal(canTransition(from, to), allowed.some(([a, b]) => a === from && b === to), `${from} -> ${to}`);
  }
  assert.equal(canTransition('UNKNOWN' as any, 'DRAFT'), false);
  assert.equal(canTransition('DRAFT', 'UNKNOWN' as any), false);
});
