import { AddressInfo } from 'node:net';
import { createMockServer } from '../../mock-linkedin/server.js';
import { env } from '../src/config/env.js';
import { createSchedulerAdapter, SchedulerAdapter } from '../src/adapters/scheduler.js';
import { createProcessDuePosts } from '../src/jobs/processDuePosts.js';
import { createLinkedInService } from '../src/services/linkedin.service.js';
import { createPostService } from '../src/services/post.service.js';

const clientId = 'mock-client-id';
const clientSecret = 'mock-client-secret';
const redirectUri = 'http://127.0.0.1/callback';
const mock = createMockServer({ clientId, clientSecret, redirectUri });
await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', () => resolve()));
const address = mock.address() as AddressInfo;
const base = `http://127.0.0.1:${address.port}`;
let scheduler: SchedulerAdapter | undefined;
let timer: NodeJS.Timeout | undefined;

try {
  const authorization = new URL('/oauth/v2/authorization', base);
  Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state: 'manual-demo-state', scope: 'openid profile w_member_social', decision: 'allow' })
    .forEach(([key, value]) => authorization.searchParams.set(key, value));
  const consent = await fetch(authorization, { redirect: 'manual' });
  const callback = new URL(consent.headers.get('location')!);
  const tokenResponse = await fetch(new URL('/oauth/v2/accessToken', base), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: callback.searchParams.get('code')!, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }),
  });
  if (!tokenResponse.ok) throw new Error('Mock OAuth setup failed.');
  const accessToken = ((await tokenResponse.json()) as any).access_token;

  const scheduledAt = new Date(Date.now() + 2 * 60_000);
  const post: any = { id: 'manual-scheduler-post', projectId: 'manual-project', content: 'Manual scheduler demo post', media: [], status: 'SCHEDULED', scheduledAt: scheduledAt.toISOString(), retryCount: 0 };
  const connection: any = { id: 'manual-connection', status: 'ACTIVE', authorUrn: 'urn:li:person:mock-member-001', access_token_encrypted: 'memory-only', access_token_expires_at: new Date(Date.now() + 60 * 60_000) };
  let publishedResolve: (value: any) => void;
  const published = new Promise((resolve) => { publishedResolve = resolve; });

  const data: any = {
    async claimDuePosts({ now, limit }: { now: Date; limit: number }) {
      if (limit < 1 || post.status !== 'SCHEDULED' || new Date(post.scheduledAt) > now) return [];
      post.status = 'PUBLISHING'; return [{ ...post }];
    },
    async getActiveConnection() { return connection; },
    async setPublished({ urn }: { urn: string }) { post.status = 'PUBLISHED'; post.linkedinPostUrn = urn; publishedResolve(post); return { ...post }; },
    async setFailed(input: any) { post.status = 'FAILED'; post.errorCode = input.code; return { ...post }; },
    async setScheduledRetry(input: any) { post.status = 'SCHEDULED'; post.scheduledAt = input.scheduledAt; post.retryCount += 1; return { ...post }; },
    async recoverStuckPublishing() { return []; },
    async saveImageUrn() {},
  };

  const linkedin = createLinkedInService({ config: { ...env, linkedinApiBase: base, linkedinOAuthBase: base, linkedinClientId: clientId, linkedinClientSecret: clientSecret }, decrypt: () => accessToken });
  const service = createPostService({ data, linkedin, storage: {} as any, notify: { notify: async () => {} }, config: env });
  const processDuePosts = createProcessDuePosts({ data, posts: service, notify: { notify: async () => {} }, config: { ...env, schedulerBatchSize: 20, missedWindowHours: 6, stuckPublishingMinutes: 10 } });
  scheduler = createSchedulerAdapter({ processDuePosts, intervalSeconds: 1 });
  console.log(`Scheduled post for ${post.scheduledAt} (two minutes ahead). Waiting for scheduler...`);
  scheduler.start();
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out waiting for the scheduled post.')), 180_000); });
  const result: any = await Promise.race([published, timeout]);
  const mockPosts: any[] = await (await fetch(new URL('/admin/posts', base))).json() as any;
  const visible = mockPosts.find((item) => item.id === result.linkedinPostUrn);
  if (!visible) throw new Error('Published post did not appear in mock /admin/posts.');
  console.log(JSON.stringify({ status: result.status, scheduledAt: result.scheduledAt, mockEndpoint: `${base}/admin/posts`, mockPost: visible }, null, 2));
} finally {
  clearTimeout(timer);
  await scheduler?.stopAndWait();
  await new Promise<void>((resolve) => mock.close(() => resolve()));
}
