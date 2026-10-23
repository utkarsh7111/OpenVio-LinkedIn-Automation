import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { healthRouter } from './routes/health.routes.js';
import { projectsRouter } from './routes/projects.routes.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { requestLogger } from './middleware/requestLogger.js';
import { linkedinRouter } from './routes/linkedin.routes.js';
import { AppError } from './utils/errors.js';
import { createUploadController } from './controllers/post.controller.js';
import { storageAdapter } from './adapters/storage.js';
// Importing the default auth adapter makes an unconfigured dev identity adapter fail closed at production startup.
import { authAdapter } from './adapters/auth.js';

export const app: express.Express = express();
void authAdapter;
const fail = (response: Response, status: number, code: string, message: string) =>
  response.status(status).json({ success: false, data: null, error: { code, message } });

app.disable('x-powered-by');
app.set('trust proxy', env.trustProxyHops); // only trust forwarded headers when behind a known proxy
app.use(requestLogger);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);
app.use((_request: Request, response: Response, next: NextFunction) => {
  response.setHeader('Cache-Control', 'no-store');
  next();
});
// Echo the origin only when it exactly matches the configured frontend; requests with no Origin
// header (curl, server-to-server) are unaffected. Unknown origins get no CORS headers at all.
app.use(
  cors({
    origin: (origin: string | undefined, callback: (err: Error | null, origin?: boolean) => void) =>
      callback(null, origin === env.frontendUrl),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    maxAge: 600,
  }),
);
app.use(express.json({ limit: '256kb' }));
app.use('/health', healthRouter);
app.use('/api', apiLimiter);
app.use('/api/projects', projectsRouter);
app.use('/api/linkedin', linkedinRouter);
app.get('/uploads/:name', createUploadController(storageAdapter));

app.use((_request: Request, response: Response) => fail(response, 404, 'NOT_FOUND', 'Route not found'));

// Central error handler. Only errors explicitly marked `expose` (AppError, body-parser 4xx)
// reach the client; everything else is logged server-side and returned as a generic 500,
// so database errors, stack traces and internal codes never leak.
app.use((error: any, _request: Request, response: Response, _next: NextFunction) => {
  if (error.type === 'entity.too.large') return fail(response, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  if (error.type === 'entity.parse.failed') return fail(response, 400, 'INVALID_JSON', 'Request body is not valid JSON');
  if (
    error.expose === true &&
    Number.isInteger(error.status) &&
    (error.status < 500 || (error instanceof AppError && error.status < 600))
  ) {
    const result: { success: false; data: null; error: { code: string; message: string; retryAfterSeconds?: number } } = {
      success: false,
      data: null,
      error: { code: error.code ?? 'BAD_REQUEST', message: error.message },
    };
    if (Number.isInteger(error.retryAfterSeconds)) result.error.retryAfterSeconds = error.retryAfterSeconds;
    return response.status(error.status).json(result);
  }
  console.error(
    JSON.stringify({
      id: response.getHeader('X-Request-Id'),
      event: 'request_failed',
      errorType: error?.name ?? 'Error',
    }),
  );
  return fail(response, 500, 'INTERNAL_ERROR', 'Internal server error');
});
