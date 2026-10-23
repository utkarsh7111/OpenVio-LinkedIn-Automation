import { AddressInfo } from 'node:net';
import { createMockServer } from '../../mock-linkedin/server.js';
import { createLinkedInService } from '../src/services/linkedin.service.js';
import { encryptToken } from '../src/utils/crypto.js';

const token = 'manual-provider-token';
const key = 'c'.repeat(64);
const mock = createMockServer();
await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', () => resolve()));

try {
  (mock as any).mockState.tokens.set(token, { sub: 'manual-member', scope: 'openid profile w_member_social', expiresAt: Date.now() + 60_000 });
  const address = mock.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  const connection = { status: 'ACTIVE' as const, access_token_encrypted: encryptToken(token, key), access_token_expires_at: new Date(Date.now() + 60_000).toISOString() };
  const linkedin = createLinkedInService({ config: { linkedinApiBase: base, linkedinOAuthBase: base, linkedinApiVersion: '202601', linkedinHttpTimeoutMs: 3000, linkedinClientId: 'mock-client-id', linkedinClientSecret: 'mock-client-secret', tokenEncryptionKey: key } as any });
  const { urn } = await linkedin.publishPost(connection, { authorUrn: 'urn:li:person:manual-member', commentary: 'Manual LinkedIn service check' });
  process.stdout.write(`Published ${urn}\n`);
  await linkedin.updatePost(connection, { postUrn: urn, commentary: 'Edited LinkedIn service check' });
  process.stdout.write('Edited commentary\n');
  await linkedin.deletePost(connection, { postUrn: urn });
  process.stdout.write('Deleted post\n');
} finally {
  await new Promise<void>((resolve) => mock.close(() => resolve()));
}
