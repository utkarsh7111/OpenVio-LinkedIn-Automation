import type { Request, Response, NextFunction } from 'express';
import { authAdapter, type AuthAdapter } from '../adapters/auth.js';
import { projectsAdapter, type ProjectsAdapter } from '../adapters/projects.js';

const fail = (response: Response, status: number, code: string, message: string) =>
  response.status(status).json({ success: false, data: null, error: { code, message } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RequireProjectAccessOptions {
  projects?: ProjectsAdapter;
  projectIdFrom?: (request: Request | any) => string | undefined;
}

export interface RequirePostProjectAccessOptions {
  data?: { getProjectId: (id: string) => Promise<string | null> };
  projects?: ProjectsAdapter;
}

export function requireAuth(adapter: AuthAdapter = authAdapter) {
  return async (request: Request | any, response: Response, next: NextFunction): Promise<any> => {
    try {
      request.user = await adapter.authenticate(request);
      if (!request.user) return fail(response, 401, 'UNAUTHENTICATED', 'Sign in to continue.');
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function requireProjectAccess({
  projects = projectsAdapter,
  projectIdFrom = (request: any) => request.params?.projectId ?? request.query?.projectId ?? request.body?.projectId,
}: RequireProjectAccessOptions = {}) {
  return async (request: Request | any, response: Response, next: NextFunction): Promise<any> => {
    try {
      const projectId = projectIdFrom(request);
      if (typeof projectId !== 'string' || !UUID.test(projectId)) return fail(response, 404, 'NOT_FOUND', 'Project not found.');
      if (!(await projects.getProject(projectId))) return fail(response, 404, 'NOT_FOUND', 'Project not found.');
      const membership = await projects.getMembership(projectId, request.user.id);
      if (!membership || !membership.linkedin_module_access) return fail(response, 403, 'FORBIDDEN', 'You do not have access to the LinkedIn module for this project.');
      request.project = { id: projectId, role: membership.role, membership };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function requireRole(...allowedRoles: string[]) {
  return (request: Request | any, response: Response, next: NextFunction): any => {
    const role = request.project?.role;
    if (!role || !allowedRoles.includes(role)) return fail(response, 403, 'FORBIDDEN', 'You do not have access to the LinkedIn module for this project.');
    return next();
  };
}

/** Protects record routes: a record owned by another project is indistinguishable from missing. */
export function requireRecordProject(getRecordProjectId: (request: Request | any) => Promise<string | null | undefined>) {
  return async (request: Request | any, response: Response, next: NextFunction): Promise<any> => {
    try {
      const recordProjectId = await getRecordProjectId(request);
      if (!recordProjectId || recordProjectId !== request.project?.id) return fail(response, 404, 'NOT_FOUND', 'Record not found.');
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

/** Resolve a post's project and authorize it without revealing inaccessible cross-project records. */
export function requirePostProjectAccess({ data, projects = projectsAdapter }: RequirePostProjectAccessOptions = {}) {
  if (!data?.getProjectId) throw new TypeError('post data access is required');
  return async (request: Request | any, response: Response, next: NextFunction): Promise<any> => {
    try {
      const projectId = await data.getProjectId(request.params.id);
      if (!projectId || !(await projects.getProject(projectId))) return fail(response, 404, 'NOT_FOUND', 'Post not found.');
      const membership = await projects.getMembership(projectId, request.user.id);
      if (!membership) return fail(response, 404, 'NOT_FOUND', 'Post not found.');
      if (!membership.linkedin_module_access) return fail(response, 403, 'FORBIDDEN', 'You do not have access to the LinkedIn module for this project.');
      request.project = { id: projectId, role: membership.role, membership };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
