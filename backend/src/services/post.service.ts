import { env, type EnvConfig } from '../config/env.js';
import { POST_STATUS, canTransition, type PostStatus } from '../config/statuses.js';
import { postData, type PostData, type PostRecord, type ListPostsQuery, type ListPostsResult } from '../db/post.data.js';
import { aiAdapter, type AiAdapter, type AiGenerateInput, type AiEnhanceInput } from '../adapters/ai.js';
import { notifyAdapter, type NotifyAdapter } from '../adapters/notify.js';
import { storageAdapter, type StorageAdapter, type SavedImageResult } from '../adapters/storage.js';
import { linkedinService, type LinkedInService } from './linkedin.service.js';
import { AppError } from '../utils/errors.js';
import { isAtLeastMinutesAhead } from '../utils/time.js';

const messages = Object.freeze({
  RECONNECT_REQUIRED: 'Your LinkedIn connection expired. Reconnect LinkedIn.',
  LINKEDIN_SCOPE: 'LinkedIn does not allow this action for the connected account.',
  LINKEDIN_REJECTED: 'LinkedIn rejected this post. Check the text and image.',
  LINKEDIN_RATE_LIMITED: 'LinkedIn rate limited this request. Try again later.',
  LINKEDIN_UNAVAILABLE: 'LinkedIn is not responding. Try again in a few minutes.',
});

function assertTransition(from: PostStatus | string, to: PostStatus | string, action: string) {
  if (!canTransition(from, to)) throw new AppError(409, 'INVALID_STATE', `This post is ${from} and cannot ${action}.`);
}
function assertNotPublishing(post: PostRecord) {
  if (post.status === POST_STATUS.PUBLISHING) throw new AppError(409, 'PUBLISH_IN_PROGRESS', 'This post is being published right now. Try again in a moment.');
}
/** The data layer refuses writes while a post is PUBLISHING (or was deleted) and returns null; surface that as a conflict. */
function changed<T>(row: T | null): T {
  if (!row) throw new AppError(409, 'POST_CHANGED', 'This post changed while you were working on it. Reload and try again.');
  return row;
}
async function withRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50 * 4 ** attempt));
    }
  }
  throw lastError;
}
function scheduleTime(value: string | Date, now: Date): string {
  if (!isAtLeastMinutesAhead(value, 5, now) || new Date(value).getTime() > now.getTime() + 365 * 86_400_000) {
    throw new AppError(422, 'SCHEDULE_IN_PAST', 'Choose a time at least 5 minutes from now and within 365 days.');
  }
  return new Date(value).toISOString();
}
function linkedInFailure(error: any): { status: number; code: string; message: string; retryAfterSeconds?: number } {
  if (error.code === 'LINKEDIN_AUTH' || error.code === 'RECONNECT_REQUIRED') return { status: 409, code: 'RECONNECT_REQUIRED', message: messages.RECONNECT_REQUIRED };
  if (error.code === 'LINKEDIN_SCOPE') return { status: 403, code: 'LINKEDIN_SCOPE', message: messages.LINKEDIN_SCOPE };
  if (error.code === 'LINKEDIN_REJECTED') return { status: 422, code: 'LINKEDIN_REJECTED', message: messages.LINKEDIN_REJECTED };
  if (error.code === 'LINKEDIN_RATE_LIMITED') return { status: 429, code: 'LINKEDIN_RATE_LIMITED', message: messages.LINKEDIN_RATE_LIMITED, retryAfterSeconds: error.retryAfterSeconds };
  return { status: 502, code: 'LINKEDIN_UNAVAILABLE', message: messages.LINKEDIN_UNAVAILABLE };
}

export interface CreatePostServiceOptions {
  data?: PostData | any;
  linkedin?: LinkedInService | any;
  storage?: StorageAdapter | any;
  ai?: AiAdapter | any;
  notify?: NotifyAdapter | any;
  config?: EnvConfig;
  clock?: () => Date;
}

export interface PostMediaItem {
  url: string;
  altText?: string;
  type?: 'image' | 'video' | 'document';
  title?: string;
  sizeBytes?: number;
  name?: string;
  linkedinImageUrn?: string;
  linkedinUrn?: string;
}

export interface CreatePostInput {
  projectId: string;
  content: string;
  media?: PostMediaItem[];
  scheduledAt?: string;
  aiGenerated?: boolean;
  idempotencyKey?: string;
}

export interface UpdatePostInput {
  content?: string;
  media?: PostMediaItem[];
  scheduledAt?: string;
}

export interface UploadInput {
  projectId?: string;
  altText?: string;
  title?: string;
  type?: 'image' | 'video' | 'document';
}

function getMediaCategory(item: PostMediaItem | any): 'image' | 'video' | 'document' {
  if (item?.type === 'video' || (typeof item?.url === 'string' && /\.(mp4|mov|webm|avi|mkv)$/i.test(item.url))) return 'video';
  if (item?.type === 'document' || (typeof item?.url === 'string' && /\.(pdf|doc|docx|ppt|pptx)$/i.test(item.url))) return 'document';
  return 'image';
}

function validateMediaList(media: PostMediaItem[] | undefined, storage: StorageAdapter): void {
  if (!media || media.length === 0) return;
  if (media.length > 20) throw new AppError(400, 'VALIDATION_ERROR', 'Fix the highlighted fields.');
  if (media.length > 1) {
    const hasNonImage = media.some((item) => getMediaCategory(item) !== 'image');
    if (hasNonImage) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Fix the highlighted fields.');
    }
  }
  for (const item of media) {
    if (!storage.validateMediaUrl(item.url)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Fix the highlighted fields.');
    }
  }
}

export interface PostService {
  create(input: CreatePostInput, userId: string): Promise<{ created: boolean; post: PostRecord }>;
  list(query: ListPostsQuery): Promise<ListPostsResult>;
  get(id: string, projectId: string): Promise<PostRecord>;
  update(id: string, projectId: string, input: UpdatePostInput, userId: string): Promise<PostRecord>;
  remove(id: string, projectId: string): Promise<{ id: string; deleted: boolean }>;
  schedule(id: string, projectId: string, scheduledAt: string, userId: string): Promise<PostRecord>;
  unschedule(id: string, projectId: string, userId: string): Promise<PostRecord>;
  publish(id: string, projectId: string, userId: string): Promise<PostRecord>;
  publishClaimed(id: string, projectId: string, post: any): Promise<{ post: PostRecord | null; outcome: string }>;
  retry(id: string, projectId: string, userId: string): Promise<PostRecord>;
  generate(input: AiGenerateInput): Promise<any>;
  enhance(input: AiEnhanceInput): Promise<{ text: string; truncated: boolean; mock: boolean }>;
  upload(input: UploadInput, buffer: Buffer): Promise<SavedImageResult & { altText?: string; title?: string; mediaCategory?: string }>;
  notifications(projectId: string, limit?: number): Promise<{ items: any[] }>;
}

/** Post workflows; OpenVio replaces the data, AI, notification, and storage adapters. */
export function createPostService({
  data = postData,
  linkedin = linkedinService,
  storage = storageAdapter,
  ai = aiAdapter,
  notify = notifyAdapter,
  config = env,
  clock = () => new Date(),
}: CreatePostServiceOptions = {}): PostService {
  async function load(id: string, projectId: string, includeEvents = false): Promise<PostRecord> {
    const post = await data.get(id, projectId, includeEvents);
    if (!post) throw new AppError(404, 'NOT_FOUND', 'Post not found.');
    return post;
  }
  async function requireConnection(projectId: string) {
    const connection = await data.getActiveConnection(projectId);
    if (!connection) throw new AppError(409, 'NOT_CONNECTED', 'Connect LinkedIn for this project first.');
    if (connection.status === 'EXPIRED') throw new AppError(409, 'RECONNECT_REQUIRED', messages.RECONNECT_REQUIRED);
    if (connection.access_token_expires_at && new Date(connection.access_token_expires_at).getTime() <= clock().getTime()) {
      await data.markConnectionExpired(projectId);
      throw new AppError(409, 'RECONNECT_REQUIRED', messages.RECONNECT_REQUIRED);
    }
    return connection;
  }
  async function providerCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: any) {
      const failure = linkedInFailure(error);
      throw new AppError(failure.status, failure.code, failure.message, failure.retryAfterSeconds);
    }
  }
  async function publishClaimed(claimed: any, { actorUserId = null, scheduler = false }: { actorUserId?: string | null; scheduler?: boolean } = {}) {
    const { id, projectId } = claimed;
    let connection: any;
    try {
      connection = await requireConnection(projectId);
      const media = claimed.media ? [...claimed.media] : [];
      if (media.length > 20) throw Object.assign(new Error('At most 20 media items are supported.'), { code: 'UNSUPPORTED_MEDIA_TYPE' });
      if (media.length > 1 && media.some((item: any) => getMediaCategory(item) !== 'image')) {
        throw Object.assign(new Error('Only multiple images (up to 20) are supported, or a single video/document.'), { code: 'UNSUPPORTED_MEDIA_TYPE' });
      }

      for (let i = 0; i < media.length; i += 1) {
        const item = media[i];
        let existingUrn = item.linkedinUrn || item.linkedinImageUrn;
        const category = getMediaCategory(item);
        if (existingUrn && category === 'video') {
          try {
            const status = await linkedin.getVideoStatus(connection, existingUrn);
            if (status !== 'AVAILABLE') existingUrn = undefined;
          } catch {
            existingUrn = undefined;
          }
        }
        if (!existingUrn) {
          const filename = item.url.includes('/') ? item.url.split('/').at(-1)! : item.url;
          const upload = await storage.readUpload(filename);
          if (!upload) throw Object.assign(new Error('The uploaded file could not be read.'), { code: 'UNSUPPORTED_MEDIA_TYPE' });

          if (category === 'video') {
            if (!linkedin.uploadVideo) throw Object.assign(new Error('Video upload is not supported by LinkedIn service.'), { code: 'UNSUPPORTED_MEDIA_TYPE' });
            const uploaded = await linkedin.uploadVideo(connection, {
              authorUrn: connection.authorUrn,
              data: upload.data,
              title: item.title ?? '',
              contentType: upload.type,
            });
            media[i] = { ...item, linkedinUrn: uploaded.videoUrn, linkedinImageUrn: uploaded.videoUrn };
            if (data.saveImageUrn) await data.saveImageUrn({ id, projectId, imageIndex: i, urn: uploaded.videoUrn });
          } else if (category === 'document') {
            if (!linkedin.uploadDocument) throw Object.assign(new Error('Document upload is not supported by LinkedIn service.'), { code: 'UNSUPPORTED_MEDIA_TYPE' });
            const uploaded = await linkedin.uploadDocument(connection, {
              authorUrn: connection.authorUrn,
              data: upload.data,
              title: item.title ?? '',
              contentType: upload.type,
            });
            media[i] = { ...item, linkedinUrn: uploaded.documentUrn, linkedinImageUrn: uploaded.documentUrn };
            if (data.saveImageUrn) await data.saveImageUrn({ id, projectId, imageIndex: i, urn: uploaded.documentUrn });
          } else {
            const uploaded = await linkedin.uploadImage(connection, {
              authorUrn: connection.authorUrn,
              data: upload.data,
              altText: item.altText ?? '',
              contentType: upload.type,
            });
            media[i] = { ...item, linkedinImageUrn: uploaded.imageUrn, linkedinUrn: uploaded.imageUrn };
            if (data.saveImageUrn) await data.saveImageUrn({ id, projectId, imageIndex: i, urn: uploaded.imageUrn });
          }
        }
      }

      const publishOptions: any = {
        authorUrn: connection.authorUrn,
        commentary: claimed.content,
      };

      if (media.length === 1) {
        const item = media[0];
        const urn = item.linkedinUrn || item.linkedinImageUrn;
        const category = getMediaCategory(item);
        if (category === 'video') {
          publishOptions.video = { id: urn, title: item.title ?? '' };
        } else if (category === 'document') {
          publishOptions.document = { id: urn, title: item.title ?? '' };
        } else {
          publishOptions.image = { id: urn, altText: item.altText ?? '' };
        }
      } else if (media.length > 1) {
        publishOptions.multiImage = {
          images: media.map((item: any) => ({
            id: item.linkedinUrn || item.linkedinImageUrn,
            altText: item.altText ?? '',
          })),
        };
      }

      const published = await linkedin.publishPost(connection, publishOptions);
      // LinkedIn already has the post at this point, so a transient database error must not lose the URN.
      const saved = await withRetry(() => data.setPublished({ id, projectId, urn: published.urn, actorUserId }));
      return { post: saved ?? (await data.get(id, projectId)), outcome: 'PUBLISHED' };
    } catch (error: any) {
      const expectedProvider = ['NOT_CONNECTED', 'LINKEDIN_AUTH', 'RECONNECT_REQUIRED', 'LINKEDIN_SCOPE', 'LINKEDIN_REJECTED', 'LINKEDIN_RATE_LIMITED', 'LINKEDIN_UNAVAILABLE'].includes(error.code);
      if (!expectedProvider && !['PAYLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE'].includes(error.code)) throw error;
      const failure = error.code === 'PAYLOAD_TOO_LARGE' || error.code === 'UNSUPPORTED_MEDIA_TYPE'
        ? { status: error.code === 'PAYLOAD_TOO_LARGE' ? 413 : 415, code: error.code, message: error.code === 'PAYLOAD_TOO_LARGE' ? 'Request body is too large.' : 'The uploaded image could not be read.', retryAfterSeconds: undefined }
        : linkedInFailure(error);
      if (scheduler && error.code === 'NOT_CONNECTED') Object.assign(failure, { code: 'RECONNECT_REQUIRED', status: 409, message: messages.RECONNECT_REQUIRED });
      if (failure.code === 'RECONNECT_REQUIRED') await data.markConnectionExpired(projectId);
      if (scheduler && ['LINKEDIN_RATE_LIMITED', 'LINKEDIN_UNAVAILABLE'].includes(failure.code)) {
        const attempt = Number(claimed.retryCount ?? 0);
        if (attempt < 3 && data.setScheduledRetry) {
          const delayMinutes = [5, 15, 60][attempt];
          const post = await data.setScheduledRetry({
            id,
            projectId,
            scheduledAt: new Date(clock().getTime() + delayMinutes * 60_000).toISOString(),
            code: failure.code,
            message: failure.message,
            actorUserId,
          });
          return { post, outcome: 'RETRY_SCHEDULED' };
        }
      }
      await data.setFailed({ id, projectId, code: failure.code, message: failure.message, actorUserId });
      await notify.notify({ postId: id, type: 'POST_FAILED', message: failure.message });
      if (scheduler) return { post: null, outcome: 'FAILED' };
      throw new AppError(failure.status, failure.code, failure.message, failure.retryAfterSeconds);
    }
  }
  async function claimAndPublish({ id, projectId, actorUserId, retryOnly = false }: { id: string; projectId: string; actorUserId: string | null; retryOnly?: boolean }): Promise<PostRecord> {
    const original = await load(id, projectId, true);
    if (original.status === POST_STATUS.PUBLISHED) throw new AppError(409, 'INVALID_STATE', `This post is ${original.status} and cannot publish again.`);
    if (original.status === POST_STATUS.PUBLISHING) throw new AppError(409, 'PUBLISH_IN_PROGRESS', 'This post is already being published.');
    const connection = await requireConnection(projectId);
    assertTransition(original.status, POST_STATUS.PUBLISHING, retryOnly ? 'retry' : 'publish');
    const claimed = await data.claim({ id, projectId, actorUserId, connectionId: connection.id, retryOnly });
    if (!claimed) {
      const current = await load(id, projectId);
      if (current.status === POST_STATUS.PUBLISHED) throw new AppError(409, 'INVALID_STATE', `This post is ${current.status} and cannot publish again.`);
      throw new AppError(409, 'PUBLISH_IN_PROGRESS', 'This post is already being published.');
    }
    return (await publishClaimed(claimed, { actorUserId })).post!;
  }

  return Object.freeze({
    async create(input: CreatePostInput, userId: string) {
      const media = input.media ?? [];
      validateMediaList(media, storage);
      const scheduledAt = input.scheduledAt ? scheduleTime(input.scheduledAt, clock()) : null;
      if (scheduledAt) {
        assertTransition(POST_STATUS.DRAFT, POST_STATUS.SCHEDULED, 'schedule');
        await requireConnection(input.projectId);
      }
      const result = await data.create({
        projectId: input.projectId,
        userId,
        content: input.content,
        media,
        scheduledAt,
        aiGenerated: input.aiGenerated ?? false,
        idempotencyKey: input.idempotencyKey,
      });
      return result;
    },
    async list(query: ListPostsQuery) {
      return data.list(query);
    },
    async get(id: string, projectId: string) {
      return load(id, projectId, true);
    },
    async update(id: string, projectId: string, input: UpdatePostInput, userId: string) {
      const post = await load(id, projectId);
      assertNotPublishing(post);
      if (post.status === POST_STATUS.PUBLISHED) {
        if (input.content === undefined || input.media !== undefined || input.scheduledAt !== undefined) {
          throw new AppError(409, 'INVALID_STATE', 'A PUBLISHED post can only update its commentary.');
        }
        await providerCall(async () => linkedin.updatePost(await requireConnection(projectId), { postUrn: post.linkedinPostUrn!, commentary: input.content! }));
        return changed(await data.update({ id, projectId, content: input.content, actorUserId: userId, detail: 'Commentary edited on LinkedIn' }));
      }
      const media = input.media;
      if (media !== undefined) validateMediaList(media, storage);
      let nextStatus = post.status === POST_STATUS.FAILED ? POST_STATUS.DRAFT : post.status;
      if (post.status === POST_STATUS.DRAFT && input.scheduledAt) {
        assertTransition(post.status, POST_STATUS.SCHEDULED, 'schedule');
        await requireConnection(projectId);
        nextStatus = POST_STATUS.SCHEDULED;
      }
      if (post.status === POST_STATUS.SCHEDULED || nextStatus !== post.status) assertTransition(post.status, nextStatus, 'edit');
      let scheduledAt: string | undefined;
      if (nextStatus === POST_STATUS.SCHEDULED) scheduledAt = scheduleTime((input.scheduledAt ?? post.scheduledAt)!, clock());
      return changed(
        await data.update({
          id,
          projectId,
          content: input.content,
          media,
          scheduledAt,
          status: nextStatus,
          clearScheduledAt: post.status === POST_STATUS.FAILED,
          clearError: post.status === POST_STATUS.FAILED,
          actorUserId: userId,
          detail: post.status === POST_STATUS.FAILED ? 'Edited; error cleared' : 'Edited',
        }),
      );
    },
    async remove(id: string, projectId: string) {
      const post = await load(id, projectId);
      assertNotPublishing(post);
      if (post.status === POST_STATUS.PUBLISHED) await providerCall(async () => linkedin.deletePost(await requireConnection(projectId), { postUrn: post.linkedinPostUrn! }));
      const removed = await data.softDelete(id, projectId);
      if (!removed) {
        const current = await data.get(id, projectId);
        if (current?.status === POST_STATUS.PUBLISHING) throw new AppError(409, 'PUBLISH_IN_PROGRESS', 'This post is being published right now. Try again in a moment.');
        throw new AppError(404, 'NOT_FOUND', 'Post not found.');
      }
      return { id, deleted: true };
    },
    async schedule(id: string, projectId: string, scheduledAt: string, userId: string) {
      const post = await load(id, projectId);
      assertNotPublishing(post);
      assertTransition(post.status, POST_STATUS.SCHEDULED, 'schedule');
      await requireConnection(projectId);
      return changed(
        await data.update({
          id,
          projectId,
          scheduledAt: scheduleTime(scheduledAt, clock()),
          status: POST_STATUS.SCHEDULED,
          actorUserId: userId,
          detail: post.status === POST_STATUS.SCHEDULED ? 'Schedule changed' : 'Scheduled',
        }),
      );
    },
    async unschedule(id: string, projectId: string, userId: string) {
      const post = await load(id, projectId);
      assertNotPublishing(post);
      assertTransition(post.status, POST_STATUS.DRAFT, 'unschedule');
      return changed(await data.update({ id, projectId, scheduledAt: null, clearScheduledAt: true, status: POST_STATUS.DRAFT, actorUserId: userId, detail: 'Unscheduled' }));
    },
    publish(id: string, projectId: string, userId: string) {
      return claimAndPublish({ id, projectId, actorUserId: userId });
    },
    async publishClaimed(id: string, projectId: string, post: any) {
      return publishClaimed({ ...post, id, projectId }, { scheduler: true });
    },
    retry(id: string, projectId: string, userId: string) {
      return claimAndPublish({ id, projectId, actorUserId: userId, retryOnly: true });
    },
    async generate(input: AiGenerateInput) {
      try {
        return await ai.generate(input);
      } catch (error: any) {
        if (error instanceof AppError) throw error;
        const status = error?.httpStatus || (error?.status && typeof error.status === 'number' ? error.status : 502);
        const code = error?.code || 'AI_UNAVAILABLE';
        const message = error?.message || 'AI generation is unavailable. Try again shortly.';
        throw new AppError(status, code, message, error?.retryAfter);
      }
    },
    async enhance(input: AiEnhanceInput) {
      try {
        const result = await ai.enhance({ content: input.content, action: input.action });
        if (!result || typeof result.text !== 'string' || !result.text.trim()) throw new Error('AI provider returned no text');
        const text = result.text.trim();
        if (text.length > 3000) throw new Error('AI provider returned content above the post limit');
        return { text, truncated: Boolean(result.truncated), mock: Boolean(result.mock) };
      } catch (error: any) {
        if (error instanceof AppError) throw error;
        const status = error?.httpStatus || (error?.status && typeof error.status === 'number' ? error.status : 502);
        const code = error?.code || 'AI_UNAVAILABLE';
        const message = error?.message || 'AI enhancement is unavailable. Try again shortly.';
        throw new AppError(status, code, message, error?.retryAfter);
      }
    },
    async upload(input: UploadInput, buffer: Buffer) {
      try {
        if (storage.saveMedia) {
          const saved = await storage.saveMedia(buffer, {
            title: input.title,
            category: input.type,
          });
          return {
            ...saved,
            altText: input.altText || undefined,
            title: input.title || saved.title || undefined,
          };
        }
        const saved = await storage.saveImage(buffer);
        return { ...saved, altText: input.altText || undefined };
      } catch (error: any) {
        if (error.code === 'PAYLOAD_TOO_LARGE') throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
        if (error.code === 'UNSUPPORTED_MEDIA_TYPE') throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Only supported media formats are allowed.');
        if (error.code === 'VALIDATION_ERROR') throw new AppError(400, 'VALIDATION_ERROR', 'Fix the highlighted fields.');
        throw error;
      }
    },
    async notifications(projectId: string, limit?: number) {
      return { items: await data.getNotifications(projectId, limit) };
    },
  });
}

export const postService = createPostService();
