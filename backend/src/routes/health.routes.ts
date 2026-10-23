import { Router, type Request, type Response } from 'express';
import { checkDatabase } from '../db/pool.js';

export function createHealthRouter(databaseCheck: () => Promise<unknown> = checkDatabase): Router {
  const router = Router();
  router.get('/', (_request: Request, response: Response) => {
    response.status(200).json({ success: true, data: { status: 'ok' }, error: null });
  });
  router.get('/ready', async (_request: Request, response: Response) => {
    try {
      await databaseCheck();
      response.status(200).json({ success: true, data: { status: 'ready' }, error: null });
    } catch {
      response.status(503).json({ success: false, data: null, error: { code: 'NOT_READY', message: 'The service is not ready.' } });
    }
  });
  return router;
}

export const healthRouter = createHealthRouter();
