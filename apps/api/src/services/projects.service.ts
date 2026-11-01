import { getDb, newId, nowIso } from '../db/database.js';
import { AppError } from '../util/appError.js';
import {
  recordActivity,
} from './events.service.js';
import { readSprintSnapshot } from './mappers.js';
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

/** Ownership-checked, API-shaped project (used by routes). */
export function getProject(projectId: string, userId: string): Project {
  return toProject(requireProject(projectId, userId));
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

// ---------- export ----------

export interface ProjectExport {
  exportedAt: string;
  format: 'devflow-project/v1';
  project: Project;
  epics: Array<{ id: string; title: string; description: string; color: string; position: number }>;
  stories: Array<{
    id: string;
    epicId: string | null;
    title: string;
    description: string;
    status: string;
    priority: string;
    points: number;
    acceptanceCriteria: string[];
    sprintId: string | null;
  }>;
  tasks: Array<{
    id: string;
    storyId: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    subtasks: Array<{ id: string; title: string; done: boolean }>;
  }>;
  sprints: Array<{
    id: string;
    name: string;
    goal: string;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
    completedAt: string | null;
    committedPoints: number | null;
    completedPoints: number | null;
  }>;
  dependencies: { stories: Array<[string, string]>; tasks: Array<[string, string]> };
}

/** Full, secret-free project snapshot for backup/migration. */
export function exportProject(projectId: string, userId: string): ProjectExport {
  const project = getProject(projectId, userId);
  const db = getDb();

  const epics = db
    .prepare('SELECT id, title, description, color, position FROM epics WHERE project_id = ? ORDER BY position, created_at')
    .all(projectId) as unknown as ProjectExport['epics'];

  const storyRows = db
    .prepare('SELECT * FROM stories WHERE project_id = ? ORDER BY position, created_at')
    .all(projectId) as unknown as Array<{
    id: string;
    epic_id: string | null;
    sprint_id: string | null;
    title: string;
    description: string;
    status: string;
    priority: string;
    points: number;
    acceptance_criteria: string;
  }>;
  const stories = storyRows.map((s) => ({
    id: s.id,
    epicId: s.epic_id,
    title: s.title,
    description: s.description,
    status: s.status,
    priority: s.priority,
    points: s.points,
    acceptanceCriteria: JSON.parse(s.acceptance_criteria) as string[],
    sprintId: s.sprint_id,
  }));

  const taskRows = db
    .prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY position, created_at')
    .all(projectId) as unknown as Array<{
    id: string;
    story_id: string;
    title: string;
    description: string;
    status: string;
    priority: string;
  }>;
  const subtaskRows = db
    .prepare(
      'SELECT s.id, s.task_id, s.title, s.done FROM subtasks s JOIN tasks t ON t.id = s.task_id WHERE t.project_id = ? ORDER BY s.position, s.rowid'
    )
    .all(projectId) as unknown as Array<{ id: string; task_id: string; title: string; done: number }>;
  const subtasksByTask = new Map<string, Array<{ id: string; title: string; done: boolean }>>();
  for (const st of subtaskRows) {
    const list = subtasksByTask.get(st.task_id) ?? [];
    list.push({ id: st.id, title: st.title, done: st.done === 1 });
    subtasksByTask.set(st.task_id, list);
  }
  const tasks = taskRows.map((t) => ({
    id: t.id,
    storyId: t.story_id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    subtasks: subtasksByTask.get(t.id) ?? [],
  }));

  const sprintRows = db
    .prepare('SELECT * FROM sprints WHERE project_id = ? ORDER BY COALESCE(starts_at, created_at)')
    .all(projectId) as unknown as Array<{
    id: string;
    name: string;
    goal: string;
    status: string;
    starts_at: string | null;
    ends_at: string | null;
    completed_at: string | null;
    metrics_snapshot: string | null;
  }>;
  const sprints = sprintRows.map((s) => {
    // snapshot parsing lives in one place (mappers.readSprintSnapshot)
    const snap = readSprintSnapshot(s);
    const committed = snap?.totalPoints ?? null;
    const completed = snap?.donePoints ?? null;
    return {
      id: s.id,
      name: s.name,
      goal: s.goal,
      status: s.status,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      completedAt: s.completed_at,
      committedPoints: committed,
      completedPoints: completed,
    };
  });

  const storyDeps = db
    .prepare('SELECT sd.story_id, sd.depends_on_story_id FROM story_dependencies sd JOIN stories s ON s.id = sd.story_id WHERE s.project_id = ?')
    .all(projectId) as unknown as Array<[string, string]>;
  const taskDeps = db
    .prepare('SELECT td.task_id, td.depends_on_task_id FROM task_dependencies td JOIN tasks t ON t.id = td.task_id WHERE t.project_id = ?')
    .all(projectId) as unknown as Array<[string, string]>;

  return {
    exportedAt: new Date().toISOString(),
    format: 'devflow-project/v1',
    project,
    epics,
    stories,
    tasks,
    sprints,
    dependencies: { stories: storyDeps, tasks: taskDeps },
  };
}
