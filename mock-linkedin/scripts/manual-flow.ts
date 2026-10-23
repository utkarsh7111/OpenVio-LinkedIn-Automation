const base = process.env.MOCK_LINKEDIN_BASE_URL ?? 'http://127.0.0.1:4100';
const clientId = process.env.MOCK_LINKEDIN_CLIENT_ID ?? 'mock-client-id';
const clientSecret = process.env.MOCK_LINKEDIN_CLIENT_SECRET ?? 'mock-client-secret';
const redirectUri = process.env.MOCK_LINKEDIN_REDIRECT_URI ?? 'http://localhost:4000/api/linkedin/callback';
const scope = 'openid profile w_member_social';

async function checked(label: string, response: Response, expected: number): Promise<Response> {
  if (response.status !== expected) throw new Error(`${label}: expected HTTP ${expected}, got ${response.status}`);
  process.stdout.write(`${label}: HTTP ${response.status}\n`);
  return response;
}

await checked('Reset', await fetch(`${base}/admin/reset`, { method: 'POST' }), 200);
const authorization = new URL('/oauth/v2/authorization', base);
authorization.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state: 'manual-run-state', scope }).toString();
await checked('Consent page', await fetch(authorization), 200);
authorization.searchParams.set('decision', 'allow');
const callback = await checked('Authorize', await fetch(authorization, { redirect: 'manual' }), 302);
const callbackLocation = callback.headers.get('location');
if (!callbackLocation) throw new Error('The mock provider did not return a callback URL');
const callbackUrl = new URL(callbackLocation);
const code = callbackUrl.searchParams.get('code');
if (!code) throw new Error('The consent step did not return an authorization code');

const tokenResponse = await checked('Token exchange', await fetch(`${base}/oauth/v2/accessToken`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }),
}), 200);
const tokenPayload = await tokenResponse.json() as { access_token: string };
const accessToken = tokenPayload.access_token;
await checked('Userinfo', await fetch(`${base}/v2/userinfo`, { headers: { Authorization: `Bearer ${accessToken}` } }), 200);
const apiHeaders = { Authorization: `Bearer ${accessToken}`, 'Linkedin-Version': '202601', 'X-Restli-Protocol-Version': '2.0.0', 'Content-Type': 'application/json' };
const createResponse = await checked('Create post', await fetch(`${base}/rest/posts`, {
  method: 'POST', headers: apiHeaders,
  body: JSON.stringify({
    author: 'urn:li:person:mock-member-001', commentary: 'Manual mock flow', visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
  }),
}), 201);
const postUrn = createResponse.headers.get('x-restli-id');
if (!postUrn) throw new Error('The mock provider did not return a post URN');
process.stdout.write(`Post URN: ${postUrn}\n`);
const encodedUrn = encodeURIComponent(postUrn);
await checked('Update post', await fetch(`${base}/rest/posts/${encodedUrn}`, {
  method: 'POST', headers: { ...apiHeaders, 'X-RestLi-Method': 'PARTIAL_UPDATE' },
  body: JSON.stringify({ patch: { $set: { commentary: 'Manual mock flow updated' } } }),
}), 204);
await checked('Delete post', await fetch(`${base}/rest/posts/${encodedUrn}`, { method: 'DELETE', headers: apiHeaders }), 204);
