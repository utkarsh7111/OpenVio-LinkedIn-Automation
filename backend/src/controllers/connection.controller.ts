import type { Request, Response, NextFunction } from 'express';
import { env, type EnvConfig } from '../config/env.js';
import { CONNECTION_REASONS, connectionService, type ConnectionService } from '../services/connection.service.js';

const envelope = (data: any) => ({ success: true, data, error: null });
const reasonSet = new Set<string>(CONNECTION_REASONS);

export interface ConnectionController {
  begin: (request: Request | any, response: Response, next: NextFunction) => Promise<void>;
  callback: (request: Request | any, response: Response) => Promise<void>;
  get: (request: Request | any, response: Response, next: NextFunction) => Promise<void>;
  disconnect: (request: Request | any, response: Response, next: NextFunction) => Promise<void>;
}

export function createConnectionController(service: ConnectionService | any = connectionService, config: EnvConfig = env): ConnectionController {
  const frontend = new URL('/dashboard/linkedin', config.frontendUrl);
  return Object.freeze({
    begin: async (request: any, response: Response, next: NextFunction) => {
      try {
        response.json(envelope(await service.begin({ projectId: request.project.id, userId: request.user.id })));
      } catch (error) {
        next(error);
      }
    },
    callback: async (request: any, response: Response) => {
      let result: any;
      try {
        result = await service.callback(request.validated.query);
      } catch {
        result = { reason: 'SERVER_ERROR' };
      }
      if (result.connected) {
        frontend.search = '?linkedin=connected';
      } else {
        frontend.search = `?linkedin=error&reason=${reasonSet.has(result.reason) ? result.reason : 'SERVER_ERROR'}`;
      }
      response.redirect(302, frontend.toString());
    },
    get: async (request: any, response: Response, next: NextFunction) => {
      try {
        response.json(
          envelope({
            ...(await service.get(request.project.id)),
            mode: config.linkedinMode === 'live' ? 'LIVE' : 'DEMO',
          }),
        );
      } catch (error) {
        next(error);
      }
    },
    disconnect: async (request: any, response: Response, next: NextFunction) => {
      try {
        response.json(envelope(await service.disconnect(request.project.id)));
      } catch (error) {
        next(error);
      }
    },
  });
}

export const connectionController = createConnectionController();
