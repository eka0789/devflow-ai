/**
 * Backlog domain: epics, stories, tasks, subtasks, dependencies and the
 * centralized task/story state transition service.
 */
import { getDb, newId, nowIso, withTransaction } from '../db/database.js';
import { AppError } from '../util/appError.js';
import { ErrorCodes, VALID_TRANSITIONS } from '@devflow/shared';
import { recordActivity } from './events.service.js';
import { requireProject, requireProjectWrite } from './projects.service.js';
import { isWorkspaceMember } from './workspace.service.js';
import { labelsForStory, labelsForTask, setStoryLabels, setTaskLabels } from './labels.service.js';
import type {
  BacklogStatus,
  Comment,
  Label,
  LabelAssignment,
  CreateEpicInput,
  CreateStoryInput,
  CreateTaskInput,
  Epic,
  Priority,
  Story,
  Subtask,
  Task,
  TransitionInput,
  UpdateStoryInput,
  UpdateTaskInput,
} from '@devflow/shared';

// ---------- row mappers ----------

interface EpicRow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  color: string;
  position: number;
  created_at: string;
  updated_at: string;
}

interface StoryRow {
  id: string;
  project_id: string;
  epic_id: string | null;
  sprint_id: string | null;
  title: string;
  description: string;
  status: string;
  priority: string;
  points: number;
  position: number;
  acceptance_criteria: string;
  assignee_user_id: string | null;
  assignee_name?: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  project_id: string;
  story_id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  position: number;
  assignee_user_id: string | null;
  assignee_name?: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

interface SubtaskRow {
  id: string;
  task_id: string;
  title: string;
  done: number;
  position: number;
}

function toEpic(row: EpicRow): Epic {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    color: row.color,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toStory(row: StoryRow): Story {
  return {
    id: row.id,
    projectId: row.project_id,
    epicId: row.epic_id,
    sprintId: row.sprint_id,
    title: row.title,
    description: row.description,
    status: row.status as BacklogStatus,
    priority: row.priority as Priority,
    points: row.points,
    position: row.position,
    acceptanceCriteria: JSON.parse(row.acceptance_criteria) as string[],
    assigneeUserId: row.assignee_user_id,
    assigneeName: row.assignee_name ?? null,
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    storyId: row.story_id,
    title: row.title,
    description: row.description,
    status: row.status as BacklogStatus,
    priority: row.priority as Priority,
    position: row.position,
    assigneeUserId: row.assignee_user_id,
    assigneeName: row.assignee_name ?? null,
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSubtask(row: SubtaskRow): Subtask {
  return { id: row.id, taskId: row.task_id, title: row.title, done: row.done === 1, position: row.position };
}

// ---------- tree ----------

export interface BacklogTree {
  epics: Epic[];
  stories: Story[];
  tasks: Task[];
  subtasks: Subtask[];
  labels: Label[];
  storyLabels: Array<{ storyId: string; labelId: string }>;
  taskLabels: Array<{ taskId: string; labelId: string }>;
  dependencies: {
    stories: Array<[string, string]>;
    tasks: Array<[string, string]>;
  };
}

export function getBacklogTree(projectId: string, userId: string): BacklogTree {
  requireProject(projectId, userId);
  const db = getDb();
  const epics = (db.prepare('SELECT * FROM epics WHERE project_id = ? ORDER BY position, created_at').all(projectId) as unknown as EpicRow[]).map(toEpic);
  const stories = (db
    .prepare(
      'SELECT st.*, u.name AS assignee_name FROM stories st LEFT JOIN users u ON u.id = st.assignee_user_id WHERE st.project_id = ? ORDER BY st.position, st.created_at'
    )
    .all(projectId) as unknown as StoryRow[]).map(toStory);
  const tasks = (db
    .prepare(
      'SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_user_id WHERE t.project_id = ? ORDER BY t.position, t.created_at'
    )
    .all(projectId) as unknown as TaskRow[]).map(toTask);
  const subtasks = (
    db
      .prepare(
        'SELECT s.* FROM subtasks s JOIN tasks t ON t.id = s.task_id WHERE t.project_id = ? ORDER BY s.position, s.rowid'
      )
      .all(projectId) as unknown as unknown as SubtaskRow[]
  ).map(toSubtask);
  const storyDeps = db
    .prepare(
      'SELECT sd.story_id, sd.depends_on_story_id FROM story_dependencies sd JOIN stories s ON s.id = sd.story_id WHERE s.project_id = ?'
    )
    .all(projectId) as Array<{ story_id: string; depends_on_story_id: string }>;
  const taskDeps = db
    .prepare(
      'SELECT td.task_id, td.depends_on_task_id FROM task_dependencies td JOIN tasks t ON t.id = td.task_id WHERE t.project_id = ?'
    )
    .all(projectId) as Array<{ task_id: string; depends_on_task_id: string }>;

  const labels = db.prepare('SELECT id, project_id, name, color, created_at FROM labels WHERE project_id = ? ORDER BY name').all(projectId) as unknown as Label[];
  const storyLabels = db
    .prepare('SELECT sl.story_id AS "storyId", sl.label_id AS "labelId" FROM story_labels sl JOIN stories st ON st.id = sl.story_id WHERE st.project_id = ?')
    .all(projectId) as Array<{ storyId: string; labelId: string }>;
  const taskLabels = db
    .prepare('SELECT tl.task_id AS "taskId", tl.label_id AS "labelId" FROM task_labels tl JOIN tasks t ON t.id = tl.task_id WHERE t.project_id = ?')
    .all(projectId) as Array<{ taskId: string; labelId: string }>;

  return {
    epics,
    stories,
    tasks,
    subtasks,
    labels,
    storyLabels,
    taskLabels,
    dependencies: {
      stories: storyDeps.map((d) => [d.story_id, d.depends_on_story_id] as [string, string]),
      tasks: taskDeps.map((d) => [d.task_id, d.depends_on_task_id] as [string, string]),
    },
  };
}

// ---------- epics ----------

export function createEpic(projectId: string, userId: string, input: CreateEpicInput): Epic {
  requireProjectWrite(projectId, userId);
  const db = getDb();
  const id = newId();
  const ts = nowIso();
  const maxPos = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS p FROM epics WHERE project_id = ?')
    .get(projectId) as { p: number };
  db.prepare(
    'INSERT INTO epics (id, project_id, title, description, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, projectId, input.title, input.description, input.color, maxPos.p + 1, ts, ts);
  recordActivity(projectId, userId, 'epic.created', `Epic "${input.title}" created`);
  return toEpic(db.prepare('SELECT * FROM epics WHERE id = ?').get(id) as unknown as EpicRow);
}

export function updateEpic(
  projectId: string,
  epicId: string,
  userId: string,
  input: { title?: string; description?: string; color?: string }
): Epic {
  requireProjectWrite(projectId, userId);
  const db = getDb();
  const row = db.prepare('SELECT * FROM epics WHERE id = ? AND project_id = ?').get(epicId, projectId) as unknown as unknown as EpicRow | undefined;
  if (!row) throw AppError.notFound('Epic');
  db.prepare('UPDATE epics SET title = ?, description = ?, color = ?, updated_at = ? WHERE id = ?').run(
    input.title ?? row.title,
    input.description ?? row.description,
    input.color ?? row.color,
    nowIso(),
    epicId
  );
  return toEpic(db.prepare('SELECT * FROM epics WHERE id = ?').get(epicId) as unknown as EpicRow);
}

export function deleteEpic(projectId: string, epicId: string, userId: string): void {
  requireProjectWrite(projectId, userId);
  const res = getDb().prepare('DELETE FROM epics WHERE id = ? AND project_id = ?').run(epicId, projectId);
  if (res.changes === 0) throw AppError.notFound('Epic');
}

// ---------- stories ----------

function getStoryRow(storyId: string, projectId: string): StoryRow {
  const row = getDb()
    .prepare('SELECT st.*, u.name AS assignee_name FROM stories st LEFT JOIN users u ON u.id = st.assignee_user_id WHERE st.id = ? AND st.project_id = ?')
    .get(storyId, projectId) as unknown as StoryRow | undefined;
  if (!row) throw AppError.notFound('Story');
  return row;
}

export interface StoryWriteInput {
  epicId?: string | null;
  title: string;
  description: string;
  points: number;
  priority: Priority;
  acceptanceCriteria: string[];
  assigneeUserId?: string | null;
  dueDate?: string | null;
  labelIds?: string[];
}

export interface StoryUpdateInput {
  epicId?: string | null;
  sprintId?: string | null;
  title?: string;
  description?: string;
  points?: number;
  priority?: Priority;
  acceptanceCriteria?: string[];
  assigneeUserId?: string | null;
  dueDate?: string | null;
  labelIds?: string[];
}

export interface TaskWriteInput {
  storyId: string;
  title: string;
  description: string;
  priority: Priority;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  labelIds?: string[];
}

/** Assignees must belong to the project's workspace. */
function assertAssignee(projectId: string, assigneeUserId: string | null | undefined): void {
  if (!assigneeUserId) return;
  const ws = getDb().prepare('SELECT workspace_id FROM projects WHERE id = ?').get(projectId) as
    | { workspace_id: string }
    | undefined;
  if (!ws || !isWorkspaceMember(ws.workspace_id, assigneeUserId)) {
    throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, 'Assignee must be a member of this workspace');
  }
}

export function createStory(projectId: string, userId: string, input: StoryWriteInput): Story {
  requireProjectWrite(projectId, userId);
  if (input.epicId) {
    const epic = getDb().prepare('SELECT id FROM epics WHERE id = ? AND project_id = ?').get(input.epicId, projectId);
    if (!epic) throw AppError.notFound('Epic');
  }
  const db = getDb();
  const id = newId();
  const ts = nowIso();
  const maxPos = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS p FROM stories WHERE project_id = ?')
    .get(projectId) as { p: number };
  assertAssignee(projectId, input.assigneeUserId);
  db.prepare(
    'INSERT INTO stories (id, project_id, epic_id, sprint_id, title, description, status, priority, points, position, acceptance_criteria, assignee_user_id, due_date, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    projectId,
    input.epicId ?? null,
    input.title,
    input.description,
    'backlog',
    input.priority,
    input.points,
    maxPos.p + 1,
    JSON.stringify(input.acceptanceCriteria),
    input.assigneeUserId ?? null,
    input.dueDate ?? null,
    ts,
    ts
  );
  if (input.labelIds && input.labelIds.length > 0) setStoryLabels(projectId, id, input.labelIds);
  recordActivity(projectId, userId, 'story.created', `Story "${input.title}" created (${input.points} pts)`);
  return toStory(getStoryRow(id, projectId));
}

export function updateStory(projectId: string, storyId: string, userId: string, input: StoryUpdateInput): Story {
  requireProjectWrite(projectId, userId);
  const row = getStoryRow(storyId, projectId);
  if (input.epicId !== undefined && input.epicId !== null) {
    const epic = getDb().prepare('SELECT id FROM epics WHERE id = ? AND project_id = ?').get(input.epicId, projectId);
    if (!epic) throw AppError.notFound('Epic');
  }
  if (input.sprintId !== undefined && input.sprintId !== null) {
    const sprint = getDb().prepare('SELECT id FROM sprints WHERE id = ? AND project_id = ?').get(input.sprintId, projectId);
    if (!sprint) throw AppError.notFound('Sprint');
    // mirror assignStory's guard: completed stories never join a sprint
    if (row.status === 'done') {
      throw AppError.conflict(ErrorCodes.CONFLICT, 'Cannot assign a completed story to a sprint');
    }
  }
  assertAssignee(projectId, input.assigneeUserId);
  getDb()
    .prepare(
      'UPDATE stories SET epic_id = ?, sprint_id = ?, title = ?, description = ?, points = ?, priority = ?, acceptance_criteria = ?, assignee_user_id = ?, due_date = ?, updated_at = ? WHERE id = ?'
    )
    .run(
      input.epicId !== undefined ? input.epicId : row.epic_id,
      input.sprintId !== undefined ? input.sprintId : row.sprint_id,
      input.title ?? row.title,
      input.description ?? row.description,
      input.points ?? row.points,
      input.priority ?? row.priority,
      input.acceptanceCriteria ? JSON.stringify(input.acceptanceCriteria) : row.acceptance_criteria,
      input.assigneeUserId !== undefined ? input.assigneeUserId : row.assignee_user_id,
      input.dueDate !== undefined ? input.dueDate : row.due_date,
      nowIso(),
      storyId
    );
  if (input.labelIds !== undefined) setStoryLabels(projectId, storyId, input.labelIds);
  return toStory(getStoryRow(storyId, projectId));
}

export function deleteStory(projectId: string, storyId: string, userId: string): void {
  requireProjectWrite(projectId, userId);
  const res = getDb().prepare('DELETE FROM stories WHERE id = ? AND project_id = ?').run(storyId, projectId);
  if (res.changes === 0) throw AppError.notFound('Story');
}

// ---------- tasks ----------

function getTaskRow(taskId: string, projectId: string): TaskRow {
  const row = getDb()
    .prepare('SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_user_id WHERE t.id = ? AND t.project_id = ?')
    .get(taskId, projectId) as unknown as TaskRow | undefined;
  if (!row) throw AppError.notFound('Task');
  return row;
}

export function createTask(projectId: string, userId: string, input: TaskWriteInput): Task {
  requireProjectWrite(projectId, userId);
  const story = getDb().prepare('SELECT id FROM stories WHERE id = ? AND project_id = ?').get(input.storyId, projectId);
  if (!story) throw AppError.notFound('Story');
  const db = getDb();
  const id = newId();
  const ts = nowIso();
  const maxPos = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS p FROM tasks WHERE story_id = ?')
    .get(input.storyId) as { p: number };
  assertAssignee(projectId, input.assigneeUserId);
  db.prepare(
    'INSERT INTO tasks (id, project_id, story_id, title, description, status, priority, position, assignee_user_id, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, projectId, input.storyId, input.title, input.description, 'todo', input.priority, maxPos.p + 1, input.assigneeUserId ?? null, input.dueDate ?? null, ts, ts);
  if (input.labelIds && input.labelIds.length > 0) setTaskLabels(projectId, id, input.labelIds);
  recordActivity(projectId, userId, 'task.created', `Task "${input.title}" created`);
  return toTask(getTaskRow(id, projectId));
}

export interface TaskUpdateInput {
  title?: string;
  description?: string;
  priority?: Priority;
  position?: number;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  labelIds?: string[];
}

export function updateTask(projectId: string, taskId: string, userId: string, input: TaskUpdateInput): Task {
  requireProjectWrite(projectId, userId);
  const row = getTaskRow(taskId, projectId);
  assertAssignee(projectId, input.assigneeUserId);
  getDb()
    .prepare('UPDATE tasks SET title = ?, description = ?, priority = ?, position = ?, assignee_user_id = ?, due_date = ?, updated_at = ? WHERE id = ?')
    .run(
      input.title ?? row.title,
      input.description ?? row.description,
      input.priority ?? row.priority,
      input.position ?? row.position,
      input.assigneeUserId !== undefined ? input.assigneeUserId : row.assignee_user_id,
      input.dueDate !== undefined ? input.dueDate : row.due_date,
      nowIso(),
      taskId
    );
  if (input.labelIds !== undefined) setTaskLabels(projectId, taskId, input.labelIds);
  return toTask(getTaskRow(taskId, projectId));
}

export function deleteTask(projectId: string, taskId: string, userId: string): void {
  requireProjectWrite(projectId, userId);
  const res = getDb().prepare('DELETE FROM tasks WHERE id = ? AND project_id = ?').run(taskId, projectId);
  if (res.changes === 0) throw AppError.notFound('Task');
}

export interface TaskDetail {
  task: Task;
  story: Story;
  subtasks: Subtask[];
  dependencies: Task[];
  comments: Comment[];
  labels: LabelAssignment[];
  timeline: Array<{ at: string; kind: 'status' | 'comment' | 'execution'; label: string }>;
}

export function getTaskDetail(projectId: string, taskId: string, userId: string): TaskDetail {
  requireProject(projectId, userId);
  const taskRow = getTaskRow(taskId, projectId);
  const storyRow = getStoryRow(taskRow.story_id, projectId);
  const subtaskRows = getDb()
    .prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY position, rowid')
    .all(taskId) as unknown as SubtaskRow[];
  const depRows = getDb()
    .prepare(
      'SELECT t.* FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_task_id WHERE d.task_id = ?'
    )
    .all(taskId) as unknown as TaskRow[];
  const commentRows = getDb()
    .prepare(
      'SELECT c.*, u.name AS user_name FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.task_id = ? ORDER BY c.created_at, c.rowid LIMIT 500'
    )
    .all(taskId) as unknown as Array<{ id: string; task_id: string; project_id: string; user_id: string; body: string; created_at: string; user_name: string | null }>;
  const taskWithNames = { ...taskRow, assignee_name: (getDb().prepare('SELECT name FROM users WHERE id = ?').get(taskRow.assignee_user_id ?? '') as { name: string } | undefined)?.name ?? null };
  const labels: LabelAssignment[] = labelsForTask(taskId).map((l) => ({ labelId: l.id, name: l.name, color: l.color }));

  // composed per-task timeline: status changes + executions + comments
  const timeline: TaskDetail['timeline'] = [];
  const statusEvents = getDb()
    .prepare(
      "SELECT to_status, created_at FROM status_events WHERE entity_type = 'task' AND entity_id = ? ORDER BY created_at LIMIT 200"
    )
    .all(taskId) as unknown as Array<{ to_status: string; created_at: string }>;
  for (const e of statusEvents) {
    timeline.push({ at: e.created_at, kind: 'status', label: `status → ${e.to_status}` });
  }
  const execs = getDb()
    .prepare('SELECT status, created_at, pr_number FROM executions WHERE task_id = ? ORDER BY created_at LIMIT 50')
    .all(taskId) as unknown as Array<{ status: string; created_at: string; pr_number: number | null }>;
  for (const e of execs) {
    timeline.push({
      at: e.created_at,
      kind: 'execution',
      label: `AI execution ${e.status.replace('_', ' ')}${e.pr_number ? ` (PR #${e.pr_number})` : ''}`,
    });
  }
  for (const c of commentRows) {
    timeline.push({ at: c.created_at, kind: 'comment', label: `comment by ${c.user_name ?? 'unknown'}` });
  }
  timeline.sort((a, b) => a.at.localeCompare(b.at));

  return {
    task: toTask(taskWithNames),
    story: toStory(storyRow),
    subtasks: subtaskRows.map(toSubtask),
    dependencies: depRows.map(toTask),
    comments: commentRows.map((c) => ({
      id: c.id,
      taskId: c.task_id,
      projectId: c.project_id,
      userId: c.user_id,
      userName: c.user_name,
      body: c.body,
      createdAt: c.created_at,
    })),
    labels,
    timeline,
  };
}

// ---------- subtasks ----------

export function createSubtask(projectId: string, taskId: string, userId: string, title: string): Subtask {
  requireProjectWrite(projectId, userId);
  getTaskRow(taskId, projectId);
  const db = getDb();
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM subtasks WHERE task_id = ?').get(taskId) as { p: number };
  const id = newId();
  db.prepare('INSERT INTO subtasks (id, task_id, title, done, position) VALUES (?, ?, ?, 0, ?)').run(id, taskId, title, maxPos.p + 1);
  return toSubtask(db.prepare('SELECT * FROM subtasks WHERE id = ?').get(id) as unknown as SubtaskRow);
}

export function updateSubtask(
  projectId: string,
  taskId: string,
  subtaskId: string,
  userId: string,
  input: { title?: string; done?: boolean }
): Subtask {
  requireProjectWrite(projectId, userId);
  getTaskRow(taskId, projectId);
  const row = getDb().prepare('SELECT * FROM subtasks WHERE id = ? AND task_id = ?').get(subtaskId, taskId) as unknown as unknown as SubtaskRow | undefined;
  if (!row) throw AppError.notFound('Subtask');
  getDb().prepare('UPDATE subtasks SET title = ?, done = ? WHERE id = ?').run(
    input.title ?? row.title,
    (input.done ?? row.done === 1) ? 1 : 0,
    subtaskId
  );
  return toSubtask(getDb().prepare('SELECT * FROM subtasks WHERE id = ?').get(subtaskId) as unknown as SubtaskRow);
}

export function deleteSubtask(projectId: string, taskId: string, subtaskId: string, userId: string): void {
  requireProjectWrite(projectId, userId);
  getTaskRow(taskId, projectId);
  const res = getDb().prepare('DELETE FROM subtasks WHERE id = ? AND task_id = ?').run(subtaskId, taskId);
  if (res.changes === 0) throw AppError.notFound('Subtask');
}

// ---------- dependencies ----------

export function addStoryDependency(projectId: string, storyId: string, dependsOnId: string, userId: string): void {
  requireProjectWrite(projectId, userId);
  getStoryRow(storyId, projectId);
  if (storyId === dependsOnId) {
    throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, 'A story cannot depend on itself');
  }
  getStoryRow(dependsOnId, projectId);
  // cycle check: does dependsOn (transitively) depend on storyId?
  if (storyHasTransitiveDependency(dependsOnId, storyId, new Set())) {
    throw AppError.conflict(ErrorCodes.VALIDATION_FAILED, 'Adding this dependency would create a cycle');
  }
  getDb()
    .prepare('INSERT OR IGNORE INTO story_dependencies (story_id, depends_on_story_id) VALUES (?, ?)')
    .run(storyId, dependsOnId);
}

function storyHasTransitiveDependency(from: string, target: string, seen: Set<string>): boolean {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  const rows = getDb()
    .prepare('SELECT depends_on_story_id AS d FROM story_dependencies WHERE story_id = ?')
    .all(from) as Array<{ d: string }>;
  return rows.some((r) => storyHasTransitiveDependency(r.d, target, seen));
}

export function removeStoryDependency(projectId: string, storyId: string, depId: string, userId: string): void {
  requireProjectWrite(projectId, userId);
  // both endpoints of the dependency must live in THIS project (cross-tenant guard)
  getStoryRow(storyId, projectId);
  getStoryRow(depId, projectId);
  const res = getDb()
    .prepare('DELETE FROM story_dependencies WHERE story_id = ? AND depends_on_story_id = ?')
    .run(storyId, depId);
  if (res.changes === 0) throw AppError.notFound('Dependency');
}

export function addTaskDependency(projectId: string, taskId: string, dependsOnId: string, userId: string): void {
  requireProjectWrite(projectId, userId);
  getTaskRow(taskId, projectId);
  if (taskId === dependsOnId) {
    throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, 'A task cannot depend on itself');
  }
  getTaskRow(dependsOnId, projectId);
  if (taskHasTransitiveDependency(dependsOnId, taskId, new Set())) {
    throw AppError.conflict(ErrorCodes.VALIDATION_FAILED, 'Adding this dependency would create a cycle');
  }
  getDb()
    .prepare('INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)')
    .run(taskId, dependsOnId);
}

function taskHasTransitiveDependency(from: string, target: string, seen: Set<string>): boolean {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  const rows = getDb()
    .prepare('SELECT depends_on_task_id AS d FROM task_dependencies WHERE task_id = ?')
    .all(from) as Array<{ d: string }>;
  return rows.some((r) => taskHasTransitiveDependency(r.d, target, seen));
}

export function removeTaskDependency(projectId: string, taskId: string, depId: string, userId: string): void {
  requireProjectWrite(projectId, userId);
  getTaskRow(taskId, projectId);
  getTaskRow(depId, projectId);
  const res = getDb()
    .prepare('DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ?')
    .run(taskId, depId);
  if (res.changes === 0) throw AppError.notFound('Dependency');
}

// ---------- centralized transition service ----------

interface TransitionableRow {
  id: string;
  project_id: string;
  status: string;
  title: string;
}

function loadEntity(entityType: 'story' | 'task', entityId: string, projectId: string): TransitionableRow {
  const table = entityType === 'story' ? 'stories' : 'tasks';
  const row = getDb()
    .prepare(`SELECT id, project_id, status, title FROM ${table} WHERE id = ? AND project_id = ?`)
    .get(entityId, projectId) as unknown as unknown as TransitionableRow | undefined;
  if (!row) throw AppError.notFound(entityType === 'story' ? 'Story' : 'Task');
  return row;
}

export function transitionEntity(
  entityType: 'story' | 'task',
  projectId: string,
  entityId: string,
  userId: string,
  input: TransitionInput
): Story | Task {
  requireProjectWrite(projectId, userId);
  const toStatus = input.status;
  const table = entityType === 'story' ? 'stories' : 'tasks';

  const result = withTransaction(() => {
    const row = loadEntity(entityType, entityId, projectId);
    const fromStatus = row.status as BacklogStatus;
    if (fromStatus === toStatus) {
      // no-op transitions are accepted and return the entity unchanged
      return { row, changed: false };
    }
    const allowed = VALID_TRANSITIONS[fromStatus];
    if (!allowed || !allowed.includes(toStatus)) {
      throw AppError.conflict(
        ErrorCodes.INVALID_TRANSITION,
        `Invalid transition: "${fromStatus}" → "${toStatus}". Allowed: ${allowed?.join(', ') ?? 'none'}`
      );
    }

    // dependency gate for forward progress
    if (['in_progress', 'in_review', 'done'].includes(toStatus)) {
      const depTable = entityType === 'story' ? 'story_dependencies' : 'task_dependencies';
      const joinTable = entityType === 'story' ? 'stories' : 'tasks';
      const pending = getDb()
        .prepare(
          `SELECT d.depends_on_${entityType}_id AS depId, e.status AS depStatus, e.title AS depTitle
           FROM ${depTable} d JOIN ${joinTable} e ON e.id = d.depends_on_${entityType}_id
           WHERE d.${entityType}_id = ? AND e.status != 'done'`
        )
        .all(entityId) as Array<{ depId: string; depStatus: string; depTitle: string }>;
      if (pending.length > 0) {
        throw AppError.conflict(
          ErrorCodes.DEPENDENCY_BLOCKED,
          `Blocked by unresolved dependencies: ${pending.map((p) => `"${p.depTitle}" (${p.depStatus})`).join(', ')}`,
          { blockedBy: pending.map((p) => p.depId) }
        );
      }
    }

    const ts = nowIso();
    getDb().prepare(`UPDATE ${table} SET status = ?, updated_at = ? WHERE id = ?`).run(toStatus, ts, entityId);
    getDb()
      .prepare(
        'INSERT INTO status_events (id, project_id, entity_type, entity_id, from_status, to_status, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(newId(), projectId, entityType, entityId, fromStatus, toStatus, userId, ts);
    return { row, changed: true, fromStatus, toStatus };
  });

  if (result.changed) {
    recordActivity(
      projectId,
      userId,
      `${entityType}.status_changed`,
      `${entityType === 'story' ? 'Story' : 'Task'} "${result.row.title}": ${result.fromStatus} → ${result.toStatus}`
    );
  }
  const fresh = getDb().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(entityId) as unknown as unknown as StoryRow | TaskRow;
  return entityType === 'story' ? toStory(fresh as unknown as StoryRow) : toTask(fresh as unknown as TaskRow);
}
