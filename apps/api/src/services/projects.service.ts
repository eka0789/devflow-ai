import { getDb, newId, nowIso } from '../db/database.js';
import { AppError } from '../util/appError.js';
import {
  recordActivity,
} from './events.service.js';
import type {
  Activity,
  Project,
  ProjectStatus,
  UpdateProjectInput,
} from '@devflow/shared';

interface ProjectRow {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  name: string;
  description: string;
  status: string;
  tech_stack: string;
  repo_full_name: string | null;
  repo_default_branch: string | null;
  created_at: string;
  updated_at: string;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerId: row.owner_user_id,
    name: row.name,
    description: row.description,
    status: row.status as ProjectStatus,
    techStack: JSON.parse(row.tech_stack) as string[],
    repoFullName: row.repo_full_name,
    repoDefaultBranch: row.repo_default_branch,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listProjects(userId: string): Project[] {
  const rows = getDb()
    .prepare('SELECT * FROM projects WHERE owner_user_id = ? ORDER BY created_at DESC')
    .all(userId) as unknown as ProjectRow[];
  return rows.map(toProject);
}

export function getProjectRow(projectId: string): ProjectRow {
  const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as
    | ProjectRow
    | undefined;
  if (!row) throw AppError.notFound('Project');
  return row;
}

/** Loads a project and enforces ownership isolation. */
export function requireProject(projectId: string, userId: string): ProjectRow {
  const row = getProjectRow(projectId);
  if (row.owner_user_id !== userId) throw AppError.notFound('Project');
  return row;
}

export function createProject(
  userId: string,
  input: { name: string; description: string; techStack: string[] }
): Project {
  const db = getDb();
  const wsRow = db
    .prepare('SELECT id FROM workspaces WHERE owner_user_id = ? ORDER BY created_at LIMIT 1')
    .get(userId) as { id: string } | undefined;
  if (!wsRow) throw AppError.notFound('Workspace');
  const id = newId();
  const ts = nowIso();
  db.prepare(
    'INSERT INTO projects (id, workspace_id, owner_user_id, name, description, status, tech_stack, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, wsRow.id, userId, input.name, input.description, 'planning', JSON.stringify(input.techStack), ts, ts);
  recordActivity(id, userId, 'project.created', `Project "${input.name}" created`);
  return toProject(getProjectRow(id));
}

export function updateProject(
  projectId: string,
  userId: string,
  input: UpdateProjectInput
): Project {
  const row = requireProject(projectId, userId);
  const next = {
    name: input.name ?? row.name,
    description: input.description ?? row.description,
    status: input.status ?? row.status,
    techStack: input.techStack ? JSON.stringify(input.techStack) : row.tech_stack,
  };
  getDb()
    .prepare(
      'UPDATE projects SET name = ?, description = ?, status = ?, tech_stack = ?, updated_at = ? WHERE id = ?'
    )
    .run(next.name, next.description, next.status, next.techStack, nowIso(), projectId);
  recordActivity(projectId, userId, 'project.updated', `Project "${next.name}" updated`);
  return toProject(getProjectRow(projectId));
}

export function deleteProject(projectId: string, userId: string): void {
  requireProject(projectId, userId);
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(projectId);
}

export function setRepo(
  projectId: string,
  userId: string,
  repoFullName: string | null,
  defaultBranch: string | null
): Project {
  requireProject(projectId, userId);
  getDb()
    .prepare('UPDATE projects SET repo_full_name = ?, repo_default_branch = ?, updated_at = ? WHERE id = ?')
    .run(repoFullName, defaultBranch, nowIso(), projectId);
  return toProject(getProjectRow(projectId));
}

interface ActivityRow {
  id: string;
  project_id: string;
  user_id: string | null;
  type: string;
  message: string;
  created_at: string;
}

export function listActivity(projectId: string, userId: string, limit: number): Activity[] {
  requireProject(projectId, userId);
  const rows = getDb()
    .prepare('SELECT * FROM activities WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(projectId, limit) as unknown as ActivityRow[];
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    userId: r.user_id,
    type: r.type,
    message: r.message,
    createdAt: r.created_at,
  }));
}

export function listGlobalActivity(userId: string, limit: number): Activity[] {
  const rows = getDb()
    .prepare(
      `SELECT a.* FROM activities a JOIN projects p ON p.id = a.project_id
       WHERE p.owner_user_id = ? ORDER BY a.created_at DESC LIMIT ?`
    )
    .all(userId, limit) as unknown as ActivityRow[];
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    userId: r.user_id,
    type: r.type,
    message: r.message,
    createdAt: r.created_at,
  }));
}
