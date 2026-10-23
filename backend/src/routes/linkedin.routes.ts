import { Router } from 'express';
import { connectionController, type ConnectionController } from '../controllers/connection.controller.js';
import { requireAuth, requireProjectAccess, requireRole, requirePostProjectAccess } from '../middleware/auth.js';
import { strictLimiter } from '../middleware/rateLimit.js';
import { validate, z } from '../middleware/validate.js';
import { postController as defaultPostController, type PostController } from '../controllers/post.controller.js';
import { postData as defaultPostData, type PostData } from '../db/post.data.js';
import { parseImageMultipart } from '../middleware/multipart.js';
import { env } from '../config/env.js';
import type { AuthAdapter } from '../adapters/auth.js';
import type { ProjectsAdapter } from '../adapters/projects.js';

const projectQuery = z.object({ projectId: z.string().uuid() }).strict();
const callbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
  error_uri: z.string().optional(),
}).strict();
const content = z.string().trim().min(1).max(3000);
const mediaItem = z.object({
  url: z.string().url(),
  altText: z.string().max(300).optional(),
  type: z.enum(['image', 'video', 'document']).optional(),
  title: z.string().max(400).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  name: z.string().max(300).optional(),
  linkedinImageUrn: z.string().optional(),
  linkedinUrn: z.string().optional(),
}).strict();
const postCreate = z.object({
  projectId: z.string().uuid(),
  content,
  media: z.array(mediaItem).max(20).optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  aiGenerated: z.boolean().optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
}).strict();
const postUpdate = z.object({
  content: content.optional(),
  media: z.array(mediaItem).max(20).optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { path: ['content'], message: 'Provide at least one editable field.' });
const scheduleBody = z.object({ scheduledAt: z.string().datetime({ offset: true }) }).strict();
const emptyBody = z.object({}).strict();
const emptyQuery = z.object({}).strict();
const listQuery = z.object({
  projectId: z.string().uuid(),
  status: z.enum(['DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  q: z.string().max(300).optional(),
}).strict();
const notificationQuery = z.object({
  projectId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
const aiBody = z.object({
  projectId: z.string().uuid(),
  topic: z.string().trim().min(3).max(3000),
  tone: z.string().trim().max(50).optional().default('professional'),
  length: z.enum(['short', 'medium', 'long']).optional().default('medium'),
  description: z.string().trim().max(3000).optional(),
  targetAudience: z.string().trim().max(300).optional(),
  objective: z.string().trim().max(300).optional(),
  keywords: z.union([z.array(z.string().max(100)), z.string().max(500)]).optional(),
  callToAction: z.string().trim().max(300).optional(),
  keyPoints: z.string().trim().max(2000).optional(),
  includeHashtags: z.boolean().optional(),
}).strict();
const aiEnhanceBody = z.object({
  projectId: z.string().uuid(),
  content: z.string().trim().min(1).max(3000),
  action: z.enum(['improve', 'professional', 'friendly', 'shorten', 'expand', 'hashtags']),
}).strict();
const mediaBody = z.object({
  projectId: z.string().uuid(),
  altText: z.string().max(300).optional(),
  title: z.string().max(400).optional(),
  type: z.enum(['image', 'video', 'document']).optional(),
}).strict();
const idParams = z.object({ id: z.string().uuid() }).strict();

export interface CreateLinkedInRouterOptions {
  controller?: ConnectionController | any;
  postController?: PostController | any;
  postData?: PostData | any;
  auth?: AuthAdapter | any;
  projects?: ProjectsAdapter | any;
  sensitiveLimiter?: any;
  mediaLimit?: number;
}

export function createLinkedInRouter({
  controller = connectionController,
  postController = defaultPostController,
  postData = defaultPostData,
  auth,
  projects,
  sensitiveLimiter = strictLimiter,
  mediaLimit,
}: CreateLinkedInRouterOptions = {}): Router {
  const effectiveMediaLimit = mediaLimit !== undefined ? mediaLimit : Math.max(env.mediaMaxBytes, 100 * 1024 * 1024);
  const router = Router();
  const authenticate = requireAuth(auth);
  const projectAccess = requireProjectAccess({ projects });
  const postProjectAccess = requirePostProjectAccess({ data: postData, projects });

  router.get('/connect', authenticate, validate(projectQuery, 'query'), projectAccess, requireRole('ADMIN', 'EDITOR'), sensitiveLimiter, controller.begin);
  // OAuth callback is bound to the stored, single-use state; browser redirects cannot carry dev headers.
  router.get('/callback', validate(callbackQuery, 'query'), controller.callback);
  router.get('/connection', authenticate, validate(projectQuery, 'query'), projectAccess, controller.get);
  router.delete('/connection', authenticate, validate(projectQuery, 'query'), projectAccess, requireRole('ADMIN', 'EDITOR'), controller.disconnect);
  router.post('/posts', authenticate, validate(postCreate), projectAccess, requireRole('ADMIN', 'EDITOR'), postController.create);
  router.get('/posts', authenticate, validate(listQuery, 'query'), projectAccess, postController.list);
  router.get('/posts/:id', authenticate, validate(emptyQuery, 'query'), validate(idParams, 'params'), postProjectAccess, postController.get);
  router.put('/posts/:id', authenticate, validate(emptyQuery, 'query'), validate(idParams, 'params'), postProjectAccess, requireRole('ADMIN', 'EDITOR'), validate(postUpdate), postController.update);
  router.delete('/posts/:id', authenticate, validate(emptyQuery, 'query'), validate(idParams, 'params'), postProjectAccess, requireRole('ADMIN', 'EDITOR'), postController.remove);
  router.post('/posts/:id/schedule', authenticate, sensitiveLimiter, validate(emptyQuery, 'query'), validate(idParams, 'params'), postProjectAccess, requireRole('ADMIN', 'EDITOR'), validate(scheduleBody), postController.schedule);
  router.post('/posts/:id/unschedule', authenticate, validate(emptyQuery, 'query'), validate(idParams, 'params'), postProjectAccess, requireRole('ADMIN', 'EDITOR'), validate(emptyBody), postController.unschedule);
  router.post('/posts/:id/publish', authenticate, sensitiveLimiter, validate(emptyQuery, 'query'), validate(idParams, 'params'), postProjectAccess, requireRole('ADMIN', 'EDITOR'), validate(emptyBody), postController.publish);
  router.post('/posts/:id/retry', authenticate, sensitiveLimiter, validate(emptyQuery, 'query'), validate(idParams, 'params'), postProjectAccess, requireRole('ADMIN', 'EDITOR'), validate(emptyBody), postController.retry);
  router.post('/ai/generate', authenticate, sensitiveLimiter, validate(aiBody), projectAccess, requireRole('ADMIN', 'EDITOR'), postController.generate);
  router.post('/ai/enhance', authenticate, sensitiveLimiter, validate(aiEnhanceBody), projectAccess, requireRole('ADMIN', 'EDITOR'), postController.enhance);
  router.post('/media', authenticate, sensitiveLimiter, parseImageMultipart({ maxBytes: effectiveMediaLimit }), validate(mediaBody), projectAccess, requireRole('ADMIN', 'EDITOR'), postController.upload);
  router.get('/notifications', authenticate, validate(notificationQuery, 'query'), projectAccess, postController.notifications);

  return router;
}

export const linkedinRouter = createLinkedInRouter();
