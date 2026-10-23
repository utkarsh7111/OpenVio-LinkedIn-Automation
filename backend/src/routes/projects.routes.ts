import { Router, type Response, type NextFunction } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthAdapter } from '../adapters/auth.js';

const envelope = (data: any) => ({ success: true, data, error: null });

export interface CreateProjectsRouterOptions {
  auth?: AuthAdapter;
  database?: any;
}

export function createProjectsRouter({ auth, database = pool }: CreateProjectsRouterOptions = {}): Router {
  const router = Router();
  router.get('/', requireAuth(auth), async (request: any, response: Response, next: NextFunction) => {
    try {
      const { rows } = await database.query(
        `SELECT p.id, p.name
         FROM projects p
         JOIN project_members pm ON pm.project_id = p.id
         WHERE pm.user_id = $1 AND pm.linkedin_module_access = true
         ORDER BY p.name`,
        [request.user.id],
      );
      response.json(
        envelope(
          rows.map((project: any) => ({
            ...project,
            slug: project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
            clientName: 'OpenVio Demo',
          })),
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  return router;
}

export const projectsRouter = createProjectsRouter();
