import { pool } from '../db/pool.js';

export interface ProjectRecord {
  id: string;
  name?: string;
}

export interface ProjectMembershipRecord {
  role: string;
  linkedin_module_access: boolean;
}

export interface ProjectsAdapter {
  getProject(projectId: string): Promise<ProjectRecord | null>;
  getMembership(projectId: string, userId: string): Promise<ProjectMembershipRecord | null>;
}

/** OpenVio replaces this adapter with its project directory and membership service. */
export function createProjectsAdapter(database: any = pool): ProjectsAdapter {
  return Object.freeze({
    async getProject(projectId: string): Promise<ProjectRecord | null> {
      const { rows } = await database.query('SELECT id FROM projects WHERE id = $1', [projectId]);
      return rows[0] ?? null;
    },
    async getMembership(projectId: string, userId: string): Promise<ProjectMembershipRecord | null> {
      const { rows } = await database.query(
        'SELECT role, linkedin_module_access FROM project_members WHERE project_id = $1 AND user_id = $2',
        [projectId, userId],
      );
      return rows[0] ?? null;
    },
  });
}

export const projectsAdapter = createProjectsAdapter();
