import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Logs method, path, status, duration. Deliberately excludes the query string:
 * the OAuth callback carries `code` and `state` there, and they must never reach logs.
 */
export function requestLogger(request: Request, response: Response, next: NextFunction): void {
  const id = randomUUID();
  const started = process.hrtime.bigint();
  response.setHeader('X-Request-Id', id);
  response.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (process.env.NODE_ENV !== 'test') {
      console.log(JSON.stringify({ id, method: request.method, path: request.path, status: response.statusCode, ms: Math.round(ms) }));
    }
  });
  next();
}
