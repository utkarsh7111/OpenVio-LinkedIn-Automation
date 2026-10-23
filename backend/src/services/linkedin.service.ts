import { env, type EnvConfig } from '../config/env.js';
import { decryptToken } from '../utils/crypto.js';
import { escapeCommentary } from '../utils/escapeCommentary.js';
import { assertLinkedInUrn } from '../utils/urn.js';

const SAFE_MESSAGES = Object.freeze({
  auth: 'LinkedIn authorization expired. Reconnect LinkedIn.',
  scope: 'LinkedIn does not allow this action for the connected account.',
  rejected: 'LinkedIn rejected this request. Check the text and image.',
  rate: 'LinkedIn rate limited this request. Try again later.',
  unavailable: 'LinkedIn is not responding. Try again in a few minutes.',
  invalid: 'The LinkedIn connection is not available. Reconnect LinkedIn.',
});

export class LinkedInError extends Error {
  code: string;
  httpStatus: number;
  retryable: boolean;
  retryAfterSeconds?: number;

  constructor(code: string, message: string, httpStatus: number, retryable: boolean, retryAfterSeconds?: number) {
    super(message);
    this.name = 'LinkedInError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : undefined;
}

function providerError(response: Response): LinkedInError {
  const status = response.status;
  if (status === 401) return new LinkedInError('LINKEDIN_AUTH', SAFE_MESSAGES.auth, status, false);
  if (status === 403) return new LinkedInError('LINKEDIN_SCOPE', SAFE_MESSAGES.scope, status, false);
  if (status === 400 || status === 422) return new LinkedInError('LINKEDIN_REJECTED', SAFE_MESSAGES.rejected, status, false);
  if (status === 429) return new LinkedInError('LINKEDIN_RATE_LIMITED', SAFE_MESSAGES.rate, status, true, parseRetryAfter(response.headers.get('retry-after')));
  return new LinkedInError('LINKEDIN_UNAVAILABLE', SAFE_MESSAGES.unavailable, status >= 500 ? status : 502, true);
}

export interface LinkedInConnectionModel {
  id?: string;
  status?: string;
  authorUrn?: string;
  access_token_expires_at?: string | Date;
  expiresAt?: string | Date;
  access_token_encrypted?: string;
  accessTokenEncrypted?: string;
}

export interface UploadImageOptions {
  authorUrn: string;
  data: Buffer | Uint8Array;
  altText?: string;
  contentType?: string;
}

export interface UploadVideoOptions {
  authorUrn: string;
  data: Buffer | Uint8Array;
  title?: string;
  contentType?: string;
}

export interface UploadDocumentOptions {
  authorUrn: string;
  data: Buffer | Uint8Array;
  title?: string;
  contentType?: string;
}

export interface PublishPostOptions {
  authorUrn: string;
  commentary: string;
  image?: {
    id: string;
    altText?: string;
  };
  multiImage?: {
    images: Array<{
      id: string;
      altText?: string;
    }>;
  };
  video?: {
    id: string;
    title?: string;
  };
  document?: {
    id: string;
    title?: string;
  };
}

export interface UpdatePostOptions {
  postUrn: string;
  commentary: string;
}

export interface DeletePostOptions {
  postUrn: string;
}

export interface CreateLinkedInServiceOptions {
  config?: EnvConfig;
  fetchImpl?: typeof fetch;
  decrypt?: (cipherText: string, keyHex: string) => string;
  clock?: () => Date;
}

export interface LinkedInService {
  getValidAccessToken(connection: LinkedInConnectionModel): string;
  uploadImage(connection: LinkedInConnectionModel, options: UploadImageOptions): Promise<{ imageUrn: string; altText: string }>;
  uploadVideo(connection: LinkedInConnectionModel, options: UploadVideoOptions): Promise<{ videoUrn: string; title: string }>;
  uploadDocument(connection: LinkedInConnectionModel, options: UploadDocumentOptions): Promise<{ documentUrn: string; title: string }>;
  getVideoStatus?(connection: LinkedInConnectionModel, videoUrn: string): Promise<string>;
  getDocumentStatus?(connection: LinkedInConnectionModel, documentUrn: string): Promise<string>;
  publishPost(connection: LinkedInConnectionModel, options: PublishPostOptions): Promise<{ urn: string }>;
  updatePost(connection: LinkedInConnectionModel, options: UpdatePostOptions): Promise<{ status: number }>;
  deletePost(connection: LinkedInConnectionModel, options: DeletePostOptions): Promise<{ status: number; deleted: boolean }>;
  revokeToken(connection: LinkedInConnectionModel): Promise<{ status: number }>;
  getProfile(connection: LinkedInConnectionModel): Promise<any>;
}

/** Provider boundary; OpenVio replaces persistence, identity, and job orchestration around this service. */
export function createLinkedInService({
  config = env,
  fetchImpl = fetch,
  decrypt = decryptToken,
  clock = () => new Date(),
}: CreateLinkedInServiceOptions = {}): LinkedInService {
  const timeoutSignal = () => AbortSignal.timeout(config.linkedinHttpTimeoutMs);
  const apiUrl = (path: string) => new URL(path, config.linkedinApiBase);
  const oauthUrl = (path: string) => new URL(path, config.linkedinOAuthBase ?? config.linkedinApiBase);
  const restHeaders = (token: string, extra: Record<string, string> = {}) => ({
    Authorization: `Bearer ${token}`,
    'LinkedIn-Version': config.linkedinApiVersion,
    'X-Restli-Protocol-Version': '2.0.0',
    Accept: 'application/json',
    ...extra,
  });

  // The upload URL comes from a provider response. Never let it point at an arbitrary or internal host.
  function assertSafeUploadUrl(value: string) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new LinkedInError('LINKEDIN_UNAVAILABLE', SAFE_MESSAGES.unavailable, 502, true);
    }
    const host = url.hostname.toLowerCase();
    const trustedLive = url.protocol === 'https:' && (host === 'linkedin.com' || host.endsWith('.linkedin.com') || host.endsWith('.licdn.com'));
    const sameAsApi = url.origin === new URL(config.linkedinApiBase).origin;
    if (config.linkedinMode === 'live' ? !trustedLive : !sameAsApi) {
      throw new LinkedInError('LINKEDIN_UNAVAILABLE', SAFE_MESSAGES.unavailable, 502, true);
    }
  }

  function getValidAccessToken(connection: LinkedInConnectionModel): string {
    if (!connection || (connection.status && connection.status !== 'ACTIVE')) {
      throw new LinkedInError('RECONNECT_REQUIRED', SAFE_MESSAGES.invalid, 409, false);
    }
    const expiry = connection.access_token_expires_at ?? connection.expiresAt;
    const expiryTime = expiry ? new Date(expiry).getTime() : Number.NaN;
    if (!Number.isFinite(expiryTime) || expiryTime <= clock().getTime()) {
      throw new LinkedInError('RECONNECT_REQUIRED', SAFE_MESSAGES.auth, 401, false);
    }
    const encrypted = connection.access_token_encrypted ?? connection.accessTokenEncrypted;
    if (!encrypted) throw new LinkedInError('RECONNECT_REQUIRED', SAFE_MESSAGES.invalid, 409, false);
    try {
      const token = decrypt(encrypted, config.tokenEncryptionKey);
      if (typeof token !== 'string' || !token) throw new Error('invalid');
      return token;
    } catch {
      throw new LinkedInError('RECONNECT_REQUIRED', SAFE_MESSAGES.invalid, 409, false);
    }
  }

  async function request(
    url: URL | string,
    {
      method = 'GET',
      token = '',
      headers = {},
      body,
      idempotent = false,
      allow404 = false,
      signedUpload = false,
    }: {
      method?: string;
      token?: string;
      headers?: Record<string, string>;
      body?: any;
      idempotent?: boolean;
      allow404?: boolean;
      signedUpload?: boolean;
    } = {},
  ): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method,
          headers: signedUpload ? headers : restHeaders(token, headers),
          body,
          signal: timeoutSignal(),
        });
      } catch {
        if (idempotent && attempt === 0) continue;
        throw new LinkedInError('LINKEDIN_UNAVAILABLE', SAFE_MESSAGES.unavailable, 502, true);
      }
      if (allow404 && response.status === 404) return response;
      if (!response.ok) {
        const errorSummary: any = await response.clone().json().catch(() => ({}));
        const upstreamCode = errorSummary?.code || errorSummary?.status || response.status;
        const upstreamMsg = errorSummary?.message || response.statusText;
        const correlationId = response.headers.get('x-li-uuid') || response.headers.get('x-correlation-id') || response.headers.get('x-request-id') || 'none';
        let safePath = url;
        try { safePath = new URL(url).pathname; } catch {}
        console.warn(`[LinkedIn Request Failure] route=${safePath} status=${response.status} upstreamCode=${upstreamCode} message="${upstreamMsg}" correlationId=${correlationId}`);
        throw providerError(response);
      }
      return response;
    }
    throw new LinkedInError('LINKEDIN_UNAVAILABLE', SAFE_MESSAGES.unavailable, 502, true);
  }

  async function responseJson(response: Response): Promise<any> {
    try {
      return await response.json();
    } catch {
      throw new LinkedInError('LINKEDIN_UNAVAILABLE', SAFE_MESSAGES.unavailable, 502, true);
    }
  }

  return Object.freeze({
    getValidAccessToken,
    async uploadImage(connection: LinkedInConnectionModel, { authorUrn, data, altText, contentType = 'application/octet-stream' }: UploadImageOptions) {
      const token = getValidAccessToken(connection);
      assertLinkedInUrn(authorUrn, 'person');
      const initialized = await request(apiUrl('/rest/images?action=initializeUpload'), {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initializeUploadRequest: { owner: authorUrn } }),
      });
      const value = (await responseJson(initialized)).value;
      if (!value?.uploadUrl || !value?.image) throw new LinkedInError('LINKEDIN_UNAVAILABLE', SAFE_MESSAGES.unavailable, 502, true);
      assertSafeUploadUrl(value.uploadUrl);
      // The upload URL is provider-signed and may be hosted separately; never forward the bearer token to it.
      await request(value.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: data, idempotent: true, signedUpload: true });
      assertLinkedInUrn(value.image, 'image');
      return { imageUrn: value.image, altText: typeof altText === 'string' ? altText : '' };
    },
    async uploadVideo(connection: LinkedInConnectionModel, { authorUrn, data, title = '', contentType = 'application/octet-stream' }: UploadVideoOptions) {
      const token = getValidAccessToken(connection);
      assertLinkedInUrn(authorUrn, 'person');
      const initialized = await request(apiUrl('/rest/videos?action=initializeUpload'), {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initializeUploadRequest: {
            owner: authorUrn,
            fileSizeBytes: data.length,
            uploadCaptions: false,
            uploadThumbnail: false,
          },
        }),
      });
      const value = (await responseJson(initialized)).value;
      if (!value?.video) throw new LinkedInError('LINKEDIN_UNAVAILABLE', SAFE_MESSAGES.unavailable, 502, true);
      assertLinkedInUrn(value.video, 'video');

      const uploadedPartIds: string[] = [];
      const uploadInstructions = value.uploadInstructions;
      if (Array.isArray(uploadInstructions) && uploadInstructions.length > 0) {
        for (const part of uploadInstructions) {
          if (!part.uploadUrl) throw new LinkedInError('LINKEDIN_UNAVAILABLE', SAFE_MESSAGES.unavailable, 502, true);
          assertSafeUploadUrl(part.uploadUrl);
          const firstByte = part.firstByte ?? 0;
          const lastByte = part.lastByte !== undefined ? part.lastByte + 1 : data.length;
          const partData = data.subarray(firstByte, lastByte);
          const uploadRes = await request(part.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': contentType },
            body: partData,
            idempotent: true,
            signedUpload: true,
          });
          const rawEtag = uploadRes.headers.get('etag') || uploadRes.headers.get('ETag') || '';
          if (rawEtag) uploadedPartIds.push(rawEtag);
        }
      } else if (value.uploadUrl) {
        assertSafeUploadUrl(value.uploadUrl);
        const uploadRes = await request(value.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': contentType },
          body: data,
          idempotent: true,
          signedUpload: true,
        });
        const rawEtag = uploadRes.headers.get('etag') || uploadRes.headers.get('ETag') || '';
        if (rawEtag) uploadedPartIds.push(rawEtag);
      } else {
        throw new LinkedInError('LINKEDIN_UNAVAILABLE', SAFE_MESSAGES.unavailable, 502, true);
      }

      // Step 3: Finalize upload with LinkedIn
      await request(apiUrl('/rest/videos?action=finalizeUpload'), {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          finalizeUploadRequest: {
            video: value.video,
            uploadToken: value.uploadToken ?? '',
            uploadedPartIds,
          },
        }),
      });

      // Step 4: Poll video processing status until AVAILABLE
      const maxAttempts = 30; // up to ~60s
      let lastStatus = 'WAITING_UPLOAD';
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const statusRes = await request(apiUrl(`/rest/videos/${encodeURIComponent(value.video)}`), { token, idempotent: true });
          const statusBody = await responseJson(statusRes);
          lastStatus = statusBody?.status ?? 'WAITING_UPLOAD';
          if (lastStatus === 'AVAILABLE') break;
          if (lastStatus === 'CLIENT_ERROR' || lastStatus === 'PROCESSING_FAILED') {
            throw new LinkedInError('LINKEDIN_REJECTED', 'LinkedIn video processing failed. Please check the video format, codec, and size.', 422, false);
          }
        } catch (pollErr) {
          if (pollErr instanceof LinkedInError && pollErr.httpStatus === 422) throw pollErr;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }

      if (lastStatus !== 'AVAILABLE') {
        console.warn(`[LinkedIn Video Processing] Video ${value.video} status after polling: ${lastStatus}`);
      }

      return { videoUrn: value.video, title };
    },
    async uploadDocument(connection: LinkedInConnectionModel, { authorUrn, data, title = '', contentType = 'application/octet-stream' }: UploadDocumentOptions) {
      const token = getValidAccessToken(connection);
      assertLinkedInUrn(authorUrn, 'person');
      const initialized = await request(apiUrl('/rest/documents?action=initializeUpload'), {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initializeUploadRequest: {
            owner: authorUrn,
          },
        }),
      });
      const value = (await responseJson(initialized)).value;
      if (!value?.uploadUrl || !value?.document) throw new LinkedInError('LINKEDIN_UNAVAILABLE', SAFE_MESSAGES.unavailable, 502, true);
      assertSafeUploadUrl(value.uploadUrl);
      await request(value.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: data,
        idempotent: true,
        signedUpload: true,
      });
      assertLinkedInUrn(value.document, 'document');
      return { documentUrn: value.document, title };
    },
    async getVideoStatus(connection: LinkedInConnectionModel, videoUrn: string) {
      const token = getValidAccessToken(connection);
      assertLinkedInUrn(videoUrn, 'video');
      const res = await request(apiUrl(`/rest/videos/${encodeURIComponent(videoUrn)}`), { token, idempotent: true });
      const json = await responseJson(res);
      return json?.status ?? 'AVAILABLE';
    },
    async getDocumentStatus(connection: LinkedInConnectionModel, documentUrn: string) {
      const token = getValidAccessToken(connection);
      assertLinkedInUrn(documentUrn, 'document');
      const res = await request(apiUrl(`/rest/documents/${encodeURIComponent(documentUrn)}`), { token, idempotent: true });
      const json = await responseJson(res);
      return json?.status ?? 'AVAILABLE';
    },
    async publishPost(connection: LinkedInConnectionModel, { authorUrn, commentary, image, multiImage, video, document }: PublishPostOptions) {
      const token = getValidAccessToken(connection);
      assertLinkedInUrn(authorUrn, 'person');
      const post: Record<string, unknown> = {
        author: authorUrn,
        commentary: escapeCommentary(commentary),
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      };
      if (image) {
        assertLinkedInUrn(image.id, 'image');
        post.content = { media: { id: image.id, altText: image.altText ?? '' } };
      } else if (multiImage && Array.isArray(multiImage.images) && multiImage.images.length > 0) {
        for (const item of multiImage.images) {
          assertLinkedInUrn(item.id, 'image');
        }
        post.content = {
          multiImage: {
            images: multiImage.images.map((item) => ({
              id: item.id,
              altText: item.altText ?? '',
            })),
          },
        };
      } else if (video) {
        assertLinkedInUrn(video.id, 'video');
        post.content = {
          media: {
            id: video.id,
            title: video.title ?? '',
          },
        };
      } else if (document) {
        assertLinkedInUrn(document.id, 'document');
        post.content = {
          media: {
            id: document.id,
            title: document.title ?? '',
          },
        };
      }
      const response = await request(apiUrl('/rest/posts'), {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(post),
        idempotent: false,
      });
      const urn = response.headers.get('x-restli-id');
      if (!urn) throw new LinkedInError('LINKEDIN_UNAVAILABLE', SAFE_MESSAGES.unavailable, 502, true);
      return { urn };
    },
    async updatePost(connection: LinkedInConnectionModel, { postUrn, commentary }: UpdatePostOptions) {
      const token = getValidAccessToken(connection);
      assertLinkedInUrn(postUrn);
      const response = await request(apiUrl(`/rest/posts/${encodeURIComponent(postUrn)}`), {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/json', 'X-RestLi-Method': 'PARTIAL_UPDATE' },
        body: JSON.stringify({ patch: { $set: { commentary: escapeCommentary(commentary) } } }),
        idempotent: true,
      });
      return { status: response.status };
    },
    async deletePost(connection: LinkedInConnectionModel, { postUrn }: DeletePostOptions) {
      const token = getValidAccessToken(connection);
      assertLinkedInUrn(postUrn);
      const response = await request(apiUrl(`/rest/posts/${encodeURIComponent(postUrn)}`), {
        method: 'DELETE',
        token,
        idempotent: true,
        allow404: true,
      });
      return { status: response.status, deleted: true };
    },
    async revokeToken(connection: LinkedInConnectionModel) {
      const token = getValidAccessToken(connection);
      const response = await request(oauthUrl('/oauth/v2/revoke'), {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: config.linkedinClientId, client_secret: config.linkedinClientSecret, token }),
        idempotent: true,
      });
      return { status: response.status };
    },
    async getProfile(connection: LinkedInConnectionModel) {
      const token = getValidAccessToken(connection);
      return responseJson(await request(apiUrl('/v2/userinfo'), { token, idempotent: true }));
    },
  });
}

export const linkedinService = createLinkedInService();
