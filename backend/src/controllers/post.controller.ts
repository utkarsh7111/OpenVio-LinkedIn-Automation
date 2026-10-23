import type { Request, Response, NextFunction } from 'express';
import { postService, type PostService } from '../services/post.service.js';
import { env, type EnvConfig } from '../config/env.js';
import type { StorageAdapter } from '../adapters/storage.js';

const envelope = (data: any) => ({ success: true, data, error: null });

function publicPost(post: any, config: EnvConfig = env) {
  if (!post) return post;
  const urn = post.linkedinPostUrn;
  return {
    ...post,
    projectId: post.projectId,
    linkedinPostUrl: urn && config.linkedinMode === 'live' ? `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/` : null,
  };
}

export interface PostController {
  create: (req: Request | any, res: Response, next: NextFunction) => Promise<void>;
  list: (req: Request | any, res: Response, next: NextFunction) => Promise<void>;
  get: (req: Request | any, res: Response, next: NextFunction) => Promise<void>;
  update: (req: Request | any, res: Response, next: NextFunction) => Promise<void>;
  remove: (req: Request | any, res: Response, next: NextFunction) => Promise<void>;
  schedule: (req: Request | any, res: Response, next: NextFunction) => Promise<void>;
  unschedule: (req: Request | any, res: Response, next: NextFunction) => Promise<void>;
  publish: (req: Request | any, res: Response, next: NextFunction) => Promise<void>;
  retry: (req: Request | any, res: Response, next: NextFunction) => Promise<void>;
  generate: (req: Request | any, res: Response, next: NextFunction) => Promise<void>;
  enhance: (req: Request | any, res: Response, next: NextFunction) => Promise<void>;
  upload: (req: Request | any, res: Response, next: NextFunction) => Promise<void>;
  notifications: (req: Request | any, res: Response, next: NextFunction) => Promise<void>;
}

export function createPostController(service: PostService | any = postService, config: EnvConfig = env): PostController {
  return Object.freeze({
    create: async (req: any, res: Response, next: NextFunction) => {
      try {
        const result = await service.create(req.validated.body, req.user.id);
        res.status(result.created ? 201 : 200).json(envelope(publicPost(result.post, config)));
      } catch (error) {
        next(error);
      }
    },
    list: async (req: any, res: Response, next: NextFunction) => {
      try {
        const result = await service.list({ ...req.validated.query, projectId: req.project.id });
        res.json(envelope({ ...result, items: result.items.map((post: any) => publicPost(post, config)) }));
      } catch (error) {
        next(error);
      }
    },
    get: async (req: any, res: Response, next: NextFunction) => {
      try {
        res.json(envelope(publicPost(await service.get(req.params.id, req.project.id), config)));
      } catch (error) {
        next(error);
      }
    },
    update: async (req: any, res: Response, next: NextFunction) => {
      try {
        res.json(envelope(publicPost(await service.update(req.params.id, req.project.id, req.validated.body, req.user.id), config)));
      } catch (error) {
        next(error);
      }
    },
    remove: async (req: any, res: Response, next: NextFunction) => {
      try {
        res.json(envelope(await service.remove(req.params.id, req.project.id)));
      } catch (error) {
        next(error);
      }
    },
    schedule: async (req: any, res: Response, next: NextFunction) => {
      try {
        res.json(envelope(publicPost(await service.schedule(req.params.id, req.project.id, req.validated.body.scheduledAt, req.user.id), config)));
      } catch (error) {
        next(error);
      }
    },
    unschedule: async (req: any, res: Response, next: NextFunction) => {
      try {
        res.json(envelope(publicPost(await service.unschedule(req.params.id, req.project.id, req.user.id), config)));
      } catch (error) {
        next(error);
      }
    },
    publish: async (req: any, res: Response, next: NextFunction) => {
      try {
        res.json(envelope(publicPost(await service.publish(req.params.id, req.project.id, req.user.id), config)));
      } catch (error) {
        next(error);
      }
    },
    retry: async (req: any, res: Response, next: NextFunction) => {
      try {
        res.json(envelope(publicPost(await service.retry(req.params.id, req.project.id, req.user.id), config)));
      } catch (error) {
        next(error);
      }
    },
    generate: async (req: any, res: Response, next: NextFunction) => {
      try {
        res.json(envelope(await service.generate(req.validated.body)));
      } catch (error) {
        next(error);
      }
    },
    enhance: async (req: any, res: Response, next: NextFunction) => {
      try {
        res.json(envelope(await service.enhance(req.validated.body)));
      } catch (error) {
        next(error);
      }
    },
    upload: async (req: any, res: Response, next: NextFunction) => {
      try {
        res.status(201).json(envelope(await service.upload(req.validated.body, req.file.buffer)));
      } catch (error) {
        next(error);
      }
    },
    notifications: async (req: any, res: Response, next: NextFunction) => {
      try {
        res.json(envelope(await service.notifications(req.project.id, req.validated.query.limit)));
      } catch (error) {
        next(error);
      }
    },
  });
}

export const postController = createPostController();

export function createUploadController(storage: StorageAdapter | any) {
  return async (request: Request | any, response: Response, next: NextFunction): Promise<any> => {
    try {
      const upload = await storage.readUpload(request.params.name);
      if (!upload) return response.status(404).json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'File not found.' } });
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      response.setHeader('Content-Disposition', 'attachment');
      response.type(upload.type).send(upload.data);
    } catch (error) {
      next(error);
    }
  };
}
