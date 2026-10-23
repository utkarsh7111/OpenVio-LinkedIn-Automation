import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const ACCESS_TOKEN_LIFETIME_SECONDS = 60 * 24 * 60 * 60;
const REQUIRED_RESTLI_VERSION = '2.0.0';
const REGISTERED_SCOPE = 'openid profile w_member_social';
const DEFAULTS = Object.freeze({
  clientId: process.env.MOCK_LINKEDIN_CLIENT_ID ?? 'mock-client-id',
  clientSecret: process.env.MOCK_LINKEDIN_CLIENT_SECRET ?? 'mock-client-secret',
  redirectUri: process.env.MOCK_LINKEDIN_REDIRECT_URI ?? 'http://localhost:4000/api/linkedin/callback',
  latencyMs: Number(process.env.MOCK_LINKEDIN_LATENCY_MS ?? 0),
  dropConnections: process.env.MOCK_LINKEDIN_DROP_CONNECTION === 'true',
});

function json(response, status, data, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(data));
}

function oauthError(response, status, error, description) {
  json(response, status, { error, error_description: description });
}

function restliError(response, status, message, headers = {}) {
  json(response, status, { message, status }, headers);
}

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

async function readBody(request, limit = 5 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  try {
    const raw = await readBody(request, 256 * 1024);
    if (!raw.length) return {};
    return JSON.parse(raw.toString('utf8'));
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error('Request body is not valid JSON'), { status: 400 });
  }
}

async function readForm(request) {
  const raw = await readBody(request, 64 * 1024);
  return new URLSearchParams(raw.toString('utf8'));
}

function bearerToken(request) {
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(request.headers.authorization ?? '');
  return match?.[1] ?? null;
}

function isUrn(value, type) {
  return typeof value === 'string' && value.startsWith(`urn:li:${type}:`) && /^[A-Za-z0-9_-]+$/.test(value.slice(`urn:li:${type}:`.length));
}

function failureFromBody(body) {
  const dropConnection = body.dropConnection === true;
  if (!Number.isInteger(body.count) || body.count < 1 || body.count > 100) throw new TypeError('count must be an integer from 1 to 100');
  if (!dropConnection && (!Number.isInteger(body.status) || body.status < 400 || body.status > 599)) throw new TypeError('status must be an HTTP error status from 400 to 599');
  if (body.retryAfter !== undefined && (!Number.isInteger(body.retryAfter) || body.retryAfter < 1 || body.retryAfter > 3600)) throw new TypeError('retryAfter must be an integer from 1 to 3600');
  if (body.method !== undefined && !/^[A-Z]+$/.test(body.method)) throw new TypeError('method must be an uppercase HTTP method');
  if (body.path !== undefined && (typeof body.path !== 'string' || !body.path.startsWith('/') || body.path.startsWith('/admin/'))) throw new TypeError('path must name a non-admin request path');
  return { status: body.status ?? 503, count: body.count, retryAfter: body.retryAfter, dropConnection, method: body.method, path: body.path };
}

/** Create an in-memory LinkedIn-compatible HTTP mock. OpenVio does not replace this test provider. */
export function createMockServer(options = {}) {
  const config = { ...DEFAULTS, ...options };
  if (!Number.isInteger(config.latencyMs) || config.latencyMs < 0 || config.latencyMs > 60_000) throw new Error('latencyMs must be an integer from 0 to 60000');
  const state = {
    authorizationCodes: new Map(),
    tokens: new Map(),
    revokedTokens: new Set(),
    images: new Map(),
    videos: new Map(),
    documents: new Map(),
    uploads: new Map(),
    posts: new Map(),
    failures: [],
  };

  async function handler(request, response) {
    const url = new URL(request.url, `http://${request.headers.host ?? 'localhost:4100'}`);
    if (url.pathname === '/health' && request.method === 'GET') return json(response, 200, { status: 'ok' });
    if (url.pathname === '/admin/reset' && request.method === 'POST') {
      for (const map of [state.authorizationCodes, state.tokens, state.images, state.videos, state.documents, state.uploads, state.posts]) map.clear();
      state.revokedTokens.clear();
      state.failures.length = 0;
      return json(response, 200, { reset: true });
    }
    if (url.pathname === '/admin/fail-next' && request.method === 'POST') {
      try {
        const failure = failureFromBody(await readJson(request));
        state.failures.push(failure);
        return json(response, 201, { queued: true, count: failure.count });
      } catch (error) { return restliError(response, 400, error.message); }
    }
    if (config.latencyMs) await new Promise((resolve) => setTimeout(resolve, config.latencyMs));
    if (config.dropConnections) return response.socket.destroy();
    const failure = state.failures.find((candidate) => (!candidate.path || candidate.path === url.pathname) && (!candidate.method || candidate.method === request.method));
    if (failure) {
      failure.count -= 1;
      if (failure.count === 0) state.failures.splice(state.failures.indexOf(failure), 1);
      if (failure.dropConnection) return response.socket.destroy();
      return restliError(response, failure.status, 'Injected mock provider failure', failure.retryAfter ? { 'Retry-After': String(failure.retryAfter) } : {});
    }

    try {
      if (url.pathname === '/admin/posts' && request.method === 'GET') return json(response, 200, [...state.posts.values()].map((post) => structuredClone(post)));

      if (url.pathname === '/oauth/v2/authorization' && request.method === 'GET') {
        const params = url.searchParams;
        const redirectUri = params.get('redirect_uri');
        const stateValue = params.get('state');
        if (params.get('response_type') !== 'code' || params.get('client_id') !== config.clientId || redirectUri !== config.redirectUri || !stateValue || params.get('scope') !== REGISTERED_SCOPE) {
          return oauthError(response, 400, 'invalid_request', 'The authorization request is invalid.');
        }
        const decision = params.get('decision');
        if (decision === 'allow' || decision === 'deny') {
          const callback = new URL(redirectUri);
          callback.searchParams.set('state', stateValue);
          if (decision === 'deny') callback.searchParams.set('error', 'user_cancelled_authorize');
          else {
            const code = randomBytes(24).toString('base64url');
            state.authorizationCodes.set(code, { clientId: config.clientId, redirectUri, scope: params.get('scope'), expiresAt: Date.now() + 300_000 });
            callback.searchParams.set('code', code);
          }
          response.writeHead(302, { Location: callback.toString(), 'Cache-Control': 'no-store' });
          return response.end();
        }
        const allow = new URL(request.url, `http://${request.headers.host ?? 'localhost:4100'}`);
        const deny = new URL(allow);
        allow.searchParams.set('decision', 'allow');
        deny.searchParams.set('decision', 'deny');
        const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Mock LinkedIn consent</title><h1>Authorize ${htmlEscape(config.clientId)}</h1><p>This local mock will grant: ${htmlEscape(params.get('scope'))}</p><a href="${htmlEscape(allow.pathname + allow.search)}">Allow</a> <a href="${htmlEscape(deny.pathname + deny.search)}">Deny</a></html>`;
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return response.end(html);
      }

      if (url.pathname === '/oauth/v2/accessToken' && request.method === 'POST') {
        if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/x-www-form-urlencoded')) return oauthError(response, 415, 'unsupported_media_type', 'Use application/x-www-form-urlencoded.');
        const form = await readForm(request);
        if (form.get('grant_type') !== 'authorization_code' || !form.get('code') || !form.get('redirect_uri') || !form.get('client_id') || !form.get('client_secret')) {
          return oauthError(response, 400, 'invalid_request', 'Required OAuth parameters are missing or invalid.');
        }
        if (form.get('client_id') !== config.clientId || form.get('client_secret') !== config.clientSecret) return oauthError(response, 401, 'invalid_client', 'Client authentication failed.');
        const grant = state.authorizationCodes.get(form.get('code'));
        if (!grant || grant.expiresAt <= Date.now() || grant.clientId !== form.get('client_id') || grant.redirectUri !== form.get('redirect_uri')) return oauthError(response, 400, 'invalid_grant', 'The authorization code or redirect URI is invalid or expired.');
        state.authorizationCodes.delete(form.get('code'));
        const accessToken = randomBytes(32).toString('base64url');
        state.tokens.set(accessToken, { sub: 'mock-member-001', scope: grant.scope, expiresAt: Date.now() + ACCESS_TOKEN_LIFETIME_SECONDS * 1000 });
        return json(response, 200, { access_token: accessToken, expires_in: ACCESS_TOKEN_LIFETIME_SECONDS, scope: grant.scope, token_type: 'Bearer' });
      }

      if (url.pathname === '/oauth/v2/revoke' && request.method === 'POST') {
        if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/x-www-form-urlencoded')) return oauthError(response, 415, 'unsupported_media_type', 'Use application/x-www-form-urlencoded.');
        const form = await readForm(request);
        if (form.get('client_id') !== config.clientId || form.get('client_secret') !== config.clientSecret || !form.get('token')) return oauthError(response, 400, 'invalid_request', 'Client credentials and token are required.');
        const tokenVal = form.get('token');
        state.revokedTokens.add(tokenVal);
        const removed = state.tokens.delete(tokenVal);
        return json(response, 200, { revoked: removed || true });
      }

      if (url.pathname === '/v2/userinfo' && request.method === 'GET') {
        const token = bearerToken(request);
        if (!token || state.revokedTokens.has(token)) return restliError(response, 401, 'Invalid or expired access token.');
        let claims = state.tokens.get(token);
        if (!claims) {
          claims = { sub: 'mock-member-001', scope: 'openid profile w_member_social', expiresAt: Date.now() + ACCESS_TOKEN_LIFETIME_SECONDS * 1000 };
          state.tokens.set(token, claims);
        } else if (claims.expiresAt <= Date.now()) {
          return restliError(response, 401, 'Invalid or expired access token.');
        }
        return json(response, 200, { sub: claims.sub, name: 'OpenVio Mock Member', given_name: 'OpenVio', family_name: 'Mock Member', picture: 'https://example.test/mock-linkedin-profile.png', locale: 'en-US' });
      }

      if (url.pathname === '/rest/images' && request.method === 'POST') {
        if (!authorizeRestli(request, state, response)) return;
        if (url.searchParams.get('action') !== 'initializeUpload') return restliError(response, 400, 'Unsupported image action.');
        const body = await readJson(request);
        const owner = body.initializeUploadRequest?.owner;
        if (!isUrn(owner, 'person')) return restliError(response, 400, 'initializeUploadRequest.owner must be a person URN.');
        const id = randomUUID().replaceAll('-', '');
        const image = `urn:li:image:${id}`;
        const uploadId = randomBytes(24).toString('base64url');
        const uploadUrl = `http://${request.headers.host ?? 'localhost:4100'}/upload/${uploadId}`;
        state.images.set(image, { owner, uploadId, uploaded: false });
        state.uploads.set(uploadId, { asset: image, image });
        return json(response, 200, { value: { uploadUrl, uploadUrlExpiresAt: Date.now() + 3_600_000, image } });
      }

      if (url.pathname === '/rest/videos' && request.method === 'POST') {
        if (!authorizeRestli(request, state, response)) return;
        const action = url.searchParams.get('action');
        if (action === 'initializeUpload') {
          const body = await readJson(request);
          const owner = body.initializeUploadRequest?.owner;
          if (!isUrn(owner, 'person')) return restliError(response, 400, 'initializeUploadRequest.owner must be a person URN.');
          const id = randomUUID().replaceAll('-', '');
          const video = `urn:li:video:${id}`;
          const uploadId = randomBytes(24).toString('base64url');
          const uploadUrl = `http://${request.headers.host ?? 'localhost:4100'}/upload/${uploadId}`;
          state.videos.set(video, { owner, uploadId, uploaded: false, status: 'WAITING_UPLOAD' });
          state.uploads.set(uploadId, { asset: video });
          const fileSizeBytes = body.initializeUploadRequest?.fileSizeBytes ?? 1024;
          return json(response, 200, {
            value: {
              uploadInstructions: [{ uploadUrl, firstByte: 0, lastByte: fileSizeBytes > 0 ? fileSizeBytes - 1 : 0 }],
              video,
              uploadToken: 'mock-upload-token',
            },
          });
        }
        if (action === 'finalizeUpload') {
          const body = await readJson(request);
          const videoUrn = body.finalizeUploadRequest?.video;
          if (!videoUrn || !isUrn(videoUrn, 'video')) return restliError(response, 400, 'finalizeUploadRequest.video must be a video URN.');
          const video = state.videos.get(videoUrn);
          if (!video) return restliError(response, 404, 'Video not found.');
          video.status = 'AVAILABLE';
          response.writeHead(204, { 'Cache-Control': 'no-store' });
          return response.end();
        }
        return restliError(response, 400, 'Unsupported video action.');
      }

      if (url.pathname.startsWith('/rest/videos/') && request.method === 'GET') {
        if (!authorizeRestli(request, state, response)) return;
        const videoUrn = decodeURIComponent(url.pathname.slice('/rest/videos/'.length));
        if (!isUrn(videoUrn, 'video')) return restliError(response, 400, 'Invalid video URN.');
        const video = state.videos.get(videoUrn);
        if (!video) return restliError(response, 404, 'Video not found.');
        return json(response, 200, { status: video.status ?? 'AVAILABLE' });
      }

      if (url.pathname === '/rest/documents' && request.method === 'POST') {
        if (!authorizeRestli(request, state, response)) return;
        if (url.searchParams.get('action') !== 'initializeUpload') return restliError(response, 400, 'Unsupported document action.');
        const body = await readJson(request);
        const owner = body.initializeUploadRequest?.owner;
        if (!isUrn(owner, 'person')) return restliError(response, 400, 'initializeUploadRequest.owner must be a person URN.');
        const id = randomUUID().replaceAll('-', '');
        const document = `urn:li:document:${id}`;
        const uploadId = randomBytes(24).toString('base64url');
        const uploadUrl = `http://${request.headers.host ?? 'localhost:4100'}/upload/${uploadId}`;
        state.documents.set(document, { owner, uploadId, uploaded: false, status: 'AVAILABLE' });
        state.uploads.set(uploadId, { asset: document });
        return json(response, 200, { value: { uploadUrl, uploadUrlExpiresAt: Date.now() + 3_600_000, document } });
      }

      if (url.pathname.startsWith('/rest/documents/') && request.method === 'GET') {
        if (!authorizeRestli(request, state, response)) return;
        const documentUrn = decodeURIComponent(url.pathname.slice('/rest/documents/'.length));
        if (!isUrn(documentUrn, 'document')) return restliError(response, 400, 'Invalid document URN.');
        const doc = state.documents.get(documentUrn);
        if (!doc) return restliError(response, 404, 'Document not found.');
        return json(response, 200, { status: doc.status ?? 'AVAILABLE' });
      }

      if (url.pathname.startsWith('/upload/') && request.method === 'PUT') {
        const uploadId = url.pathname.slice('/upload/'.length);
        const upload = state.uploads.get(uploadId);
        if (!upload) return restliError(response, 404, 'Upload URL not found or expired.');
        const assetUrn = upload.asset || upload.image;
        const asset = state.images.get(assetUrn) || state.videos.get(assetUrn) || state.documents.get(assetUrn);
        if (asset) {
          asset.uploaded = true;
          asset.bytes = await readBody(request, 100 * 1024 * 1024);
        }
        response.writeHead(201, { ETag: '"mock-etag-part-1"', 'Cache-Control': 'no-store' });
        return response.end();
      }

      if (url.pathname === '/rest/posts' && request.method === 'POST') {
        if (!authorizeRestli(request, state, response)) return;
        const body = await readJson(request);
        const invalid = validatePost(body, state);
        if (invalid) return restliError(response, 400, invalid);
        const urn = `urn:li:share:${Date.now()}${randomBytes(4).readUInt32BE(0)}`;
        state.posts.set(urn, { id: urn, ...structuredClone(body), createdAt: Date.now(), updatedAt: Date.now() });
        response.writeHead(201, { 'x-restli-id': urn, 'Cache-Control': 'no-store' });
        return response.end();
      }

      if (url.pathname.startsWith('/rest/posts/') && request.method === 'POST') {
        if (!authorizeRestli(request, state, response)) return;
        if (request.headers['x-restli-method'] !== 'PARTIAL_UPDATE') return restliError(response, 400, 'X-RestLi-Method must be PARTIAL_UPDATE.');
        const urn = decodeURIComponent(url.pathname.slice('/rest/posts/'.length));
        const body = await readJson(request);
        const patch = body.patch?.$set;
        if (!patch || Object.keys(body).length !== 1 || Object.keys(body.patch).length !== 1 || Object.keys(patch).some((key) => key !== 'commentary') || typeof patch.commentary !== 'string' || !patch.commentary.trim()) {
          return restliError(response, 400, 'Only a non-empty commentary field can be updated.');
        }
        let post = state.posts.get(urn);
        if (!post) {
          post = { id: urn, commentary: patch.commentary, createdAt: Date.now(), updatedAt: Date.now() };
          state.posts.set(urn, post);
        } else {
          post.commentary = patch.commentary;
          post.updatedAt = Date.now();
        }
        response.writeHead(204, { 'Cache-Control': 'no-store' });
        return response.end();
      }

      if (url.pathname.startsWith('/rest/posts/') && request.method === 'DELETE') {
        if (!authorizeRestli(request, state, response)) return;
        const urn = decodeURIComponent(url.pathname.slice('/rest/posts/'.length));
        if (!state.posts.delete(urn)) return restliError(response, 404, 'Post not found.');
        response.writeHead(204, { 'Cache-Control': 'no-store' });
        return response.end();
      }

      return restliError(response, 404, 'Resource not found.');
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      if (error.status === 413) return restliError(response, 413, 'Request body is too large.');
      if (error.status === 400) return restliError(response, 400, error.message);
      return restliError(response, 500, 'Mock provider internal error.');
    }
  }

  function authorizeRestli(request, currentState, response) {
    if (request.headers['x-restli-protocol-version'] !== REQUIRED_RESTLI_VERSION) {
      restliError(response, 400, `X-Restli-Protocol-Version must be ${REQUIRED_RESTLI_VERSION}.`);
      return false;
    }
    const token = bearerToken(request);
    if (!token || currentState.revokedTokens?.has(token)) {
      restliError(response, 401, 'Invalid or expired access token.');
      return false;
    }
    let claims = currentState.tokens.get(token);
    if (!claims) {
      claims = { sub: 'mock-member-001', scope: 'openid profile w_member_social', expiresAt: Date.now() + ACCESS_TOKEN_LIFETIME_SECONDS * 1000 };
      currentState.tokens.set(token, claims);
    } else if (claims.expiresAt <= Date.now()) {
      restliError(response, 401, 'Invalid or expired access token.');
      return false;
    }
    if (!String(request.headers['linkedin-version'] ?? '').match(/^\d{6}$/)) {
      restliError(response, 400, 'Linkedin-Version must use YYYYMM format.');
      return false;
    }
    if (request.method === 'POST' && !String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      restliError(response, 415, 'Content-Type must be application/json.');
      return false;
    }
    return true;
  }

  function validatePost(body, currentState) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Post body must be a JSON object.';
    if (!isUrn(body.author, 'person')) return 'author must be a person URN.';
    if (typeof body.commentary !== 'string' || !body.commentary.trim() || body.commentary.length > 3000) return 'commentary must contain 1 to 3000 characters.';
    if (body.visibility !== 'PUBLIC' || body.lifecycleState !== 'PUBLISHED' || typeof body.isReshareDisabledByAuthor !== 'boolean') return 'Post visibility, lifecycleState, or reshare flag is invalid.';
    const distribution = body.distribution;
    if (!distribution || distribution.feedDistribution !== 'MAIN_FEED' || !Array.isArray(distribution.targetEntities) || !Array.isArray(distribution.thirdPartyDistributionChannels)) return 'distribution is invalid.';
    if (body.content !== undefined) {
      if (body.content.multiImage) {
        const images = body.content.multiImage.images;
        if (!Array.isArray(images) || images.length < 2 || images.length > 20) {
          return 'content.multiImage.images must contain between 2 and 20 images.';
        }
        for (const img of images) {
          if (!isUrn(img.id, 'image')) return 'Each multiImage item must contain an image URN.';
          if (!currentState.images.get(img.id)?.uploaded) return 'All images must finish uploading before post creation.';
        }
      } else if (body.content.media) {
        const media = body.content.media;
        if (isUrn(media.id, 'image')) {
          if (media.altText !== undefined && (typeof media.altText !== 'string' || media.altText.length > 300)) {
            return 'content.media must contain an image URN and optional alt text up to 300 characters.';
          }
          if (!currentState.images.get(media.id)?.uploaded) return 'Image must finish uploading before post creation.';
        } else if (isUrn(media.id, 'video')) {
          if (media.title !== undefined && (typeof media.title !== 'string' || media.title.length > 400)) {
            return 'content.media video title must be up to 400 characters.';
          }
          if (!currentState.videos.get(media.id)?.uploaded) return 'Video must finish uploading before post creation.';
        } else if (isUrn(media.id, 'document')) {
          if (media.title !== undefined && (typeof media.title !== 'string' || media.title.length > 400)) {
            return 'content.media document title must be up to 400 characters.';
          }
          if (!currentState.documents.get(media.id)?.uploaded) return 'Document must finish uploading before post creation.';
        } else {
          return 'content.media must contain a valid image, video, or document URN.';
        }
      } else {
        return 'content must specify media or multiImage.';
      }
    }
    return null;
  }

  const server = createServer(handler);
  server.mockState = state;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createMockServer();
  server.listen(Number(process.env.PORT ?? 4100), '127.0.0.1', () => process.stdout.write(`Mock LinkedIn listening on http://127.0.0.1:${server.address().port}\n`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
