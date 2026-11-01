/**
 * Sprint lifecycle and metrics. All metrics are computed from real data:
 * stories, status_events and sprint completion snapshots.
 */
import { getDb, newId, nowIso, withTransaction } from '../db/database.js';
import { AppError } from '../util/appError.js';
import { ErrorCodes } from '@devflow/shared';
import { recordActivity, notify } from './events.service.js';
import { requireProject } from './projects.service.js';
import type {
  BacklogStatus,
  BurndownPoint,
  CreateSprintInput,
  Sprint,
  SprintMetrics,
  SprintStatus,
  VelocityPoint,
} from '@devflow/shared';

interface SprintRow {
  id: string;
  project_id: string;
  name: string;
  goal: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  completed_at: string | null;
  metrics_snapshot: string | null;
}

function toSprint(row: SprintRow): Sprint {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    goal: row.goal,
    status: row.status as SprintStatus,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function getSprintRow(sprintId: string, projectId: string): SprintRow {
  const row = getDb()
    .prepare('SELECT * FROM sprints WHERE id = ? AND project_id = ?')
    .get(sprintId, projectId) as unknown as unknown as SprintRow | undefined;
  if (!row) throw AppError.notFound('Sprint');
  return row;
}

export function listSprints(projectId: string, userId: string): Sprint[] {
  requireProject(projectId, userId);
  const rows = getDb()
    .prepare(
      "SELECT * FROM sprints WHERE project_id = ? ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, created_at DESC"
    )
    .all(projectId) as unknown as SprintRow[];
  return rows.map(toSprint);
}

export function createSprint(projectId: string, userId: string, input: CreateSprintInput): Sprint {
  requireProject(projectId, userId);
  const db = getDb();
  const id = newId();
  db.prepare(
    'INSERT INTO sprints (id, project_id, name, goal, status, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, projectId, input.name, input.goal, 'planned', input.startsAt ?? null, input.endsAt ?? null, nowIso());
  recordActivity(projectId, userId, 'sprint.created', `Sprint "${input.name}" created`);
  return toSprint(getSprintRow(id, projectId));
}

export function updateSprint(
  projectId: string,
  sprintId: string,
  userId: string,
  input: { name?: string; goal?: string; startsAt?: string | null; endsAt?: string | null }
): Sprint {
  requireProject(projectId, userId);
  const row = getSprintRow(sprintId, projectId);
  if (row.status === 'completed' || row.status === 'cancelled') {
    throw AppError.conflict(ErrorCodes.CONFLICT, `Cannot edit a ${row.status} sprint`);
  }
  getDb()
    .prepare('UPDATE sprints SET name = ?, goal = ?, starts_at = ?, ends_at = ? WHERE id = ?')
    .run(
      input.name ?? row.name,
      input.goal ?? row.goal,
      input.startsAt !== undefined ? input.startsAt : row.starts_at,
      input.endsAt !== undefined ? input.endsAt : row.ends_at,
      sprintId
    );
  return toSprint(getSprintRow(sprintId, projectId));
}

export function assignStory(projectId: string, sprintId: string, storyId: string, userId: string): void {
  requireProject(projectId, userId);
  getSprintRow(sprintId, projectId);
  const story = getDb()
    .prepare('SELECT id, title, status FROM stories WHERE id = ? AND project_id = ?')
    .get(storyId, projectId) as { id: string; title: string; status: string } | undefined;
  if (!story) throw AppError.notFound('Story');
  if (story.status === 'done') {
    throw AppError.conflict(ErrorCodes.CONFLICT, 'Cannot assign a completed story to a sprint');
  }
  getDb().prepare('UPDATE stories SET sprint_id = ?, updated_at = ? WHERE id = ?').run(sprintId, nowIso(), storyId);
  recordActivity(projectId, userId, 'sprint.story_added', `Story "${story.title}" added to sprint`);
}

export function unassignStory(projectId: string, sprintId: string, storyId: string, userId: string): void {
  requireProject(projectId, userId);
  getSprintRow(sprintId, projectId);
  getDb().prepare('UPDATE stories SET sprint_id = NULL, updated_at = ? WHERE id = ? AND sprint_id = ?').run(nowIso(), storyId, sprintId);
}

export function activateSprint(projectId: string, sprintId: string, userId: string): Sprint {
  requireProject(projectId, userId);
  const row = getSprintRow(sprintId, projectId);
  if (row.status !== 'planned') {
    throw AppError.conflict(ErrorCodes.CONFLICT, `Only planned sprints can be activated (current: ${row.status})`);
  }
  const db = getDb();
  const storyCount = db
    .prepare('SELECT COUNT(*) AS c FROM stories WHERE sprint_id = ?')
    .get(sprintId) as { c: number };
  if (storyCount.c === 0) {
    throw AppError.conflict(ErrorCodes.CONFLICT, 'Cannot activate an empty sprint — assign stories first');
  }
  const active = db
    .prepare("SELECT id FROM sprints WHERE project_id = ? AND status = 'active' AND id != ?")
    .get(projectId, sprintId) as { id: string } | undefined;
  if (active) {
    throw AppError.conflict(ErrorCodes.CONFLICT, 'Another sprint is already active. Complete it first.');
  }
  withTransaction(() => {
    db.prepare("UPDATE sprints SET status = 'active', starts_at = COALESCE(starts_at, ?) WHERE id = ?").run(nowIso(), sprintId);
    // stories in the sprint that are still in backlog move to todo
    const backlogStories = db
      .prepare("SELECT id FROM stories WHERE sprint_id = ? AND status = 'backlog'")
      .all(sprintId) as Array<{ id: string }>;
    for (const s of backlogStories) {
      db.prepare("UPDATE stories SET status = 'todo', updated_at = ? WHERE id = ?").run(nowIso(), s.id);
      db.prepare(
        'INSERT INTO status_events (id, project_id, entity_type, entity_id, from_status, to_status, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(newId(), projectId, 'story', s.id, 'backlog', 'todo', userId, nowIso());
    }
  });
  recordActivity(projectId, userId, 'sprint.activated', `Sprint "${row.name}" activated`);
  return toSprint(getSprintRow(sprintId, projectId));
}

// ---------- metrics ----------

interface SprintStoryRow {
  id: string;
  points: number;
  status: string;
}

function firstDoneAtMap(storyIds: string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (storyIds.length === 0) return map;
  const placeholders = storyIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT entity_id, MIN(created_at) AS firstDone FROM status_events
       WHERE entity_type = 'story' AND to_status = 'done' AND entity_id IN (${placeholders})
       GROUP BY entity_id`
    )
    .all(...storyIds) as Array<{ entity_id: string; firstDone: string }>;
  for (const r of rows) map.set(r.entity_id, r.firstDone);
  return map;
}

export function computeSprintMetrics(sprintRow: SprintRow): SprintMetrics {
  const db = getDb();
  const stories = db
    .prepare('SELECT id, points, status FROM stories WHERE sprint_id = ?')
    .all(sprintRow.id) as unknown as SprintStoryRow[];

  const totalPoints = stories.reduce((sum, s) => sum + s.points, 0);
  const doneStories = stories.filter((s) => s.status === 'done');
  const donePoints = doneStories.reduce((sum, s) => sum + s.points, 0);
  const openTasks = (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM tasks t JOIN stories s ON s.id = t.story_id WHERE s.sprint_id = ? AND t.status NOT IN ('done', 'cancelled')"
      )
      .get(sprintRow.id) as { c: number }
  ).c;

  const startStr = sprintRow.starts_at ?? sprintRow.created_at;
  const start = new Date(startStr);
  const endRaw = sprintRow.ends_at ?? sprintRow.completed_at;
  const end = endRaw ? new Date(endRaw) : new Date();
  const sprintDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000) || 14);
  const days = Math.min(90, Math.max(sprintDays, 1));

  const doneAt = firstDoneAtMap(stories.map((s) => s.id));
  const burndown: BurndownPoint[] = [];
  const dayMs = 86400000;
  const startDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  for (let i = 0; i <= days; i++) {
    const dayEnd = new Date(startDay.getTime() + i * dayMs + dayMs - 1);
    const label = dayEnd.toISOString().slice(0, 10);
    const burned = doneStories
      .filter((s) => {
        const at = doneAt.get(s.id);
        return at !== undefined && new Date(at).getTime() <= dayEnd.getTime();
      })
      .reduce((sum, s) => sum + s.points, 0);
    const addedAfterStart = stories
      .filter((s) => !doneAt.has(s.id))
      .reduce((sum, s) => sum + s.points, 0);
    const remaining = totalPoints - burned;
    const ideal = Math.max(0, Math.round((totalPoints * (days - i)) / days));
    burndown.push({ date: label, remaining, ideal });
    void addedAfterStart;
  }

  return {
    sprint: toSprint(sprintRow),
    totalPoints,
    donePoints,
    totalStories: stories.length,
    doneStories: doneStories.length,
    openTasks,
    burndown,
    completionRate: totalPoints > 0 ? Math.round((donePoints / totalPoints) * 100) : 0,
  };
}

export function getSprintMetrics(projectId: string, sprintId: string, userId: string): SprintMetrics {
  requireProject(projectId, userId);
  const row = getSprintRow(sprintId, projectId);
  if (row.metrics_snapshot) {
    const snap = JSON.parse(row.metrics_snapshot) as SprintMetrics;
    // refresh sprint identity fields (name etc.) from the row
    return { ...snap, sprint: toSprint(row) };
  }
  return computeSprintMetrics(row);
}

export function completeSprint(projectId: string, sprintId: string, userId: string): SprintMetrics {
  requireProject(projectId, userId);
  const row = getSprintRow(sprintId, projectId);
  if (row.status !== 'active') {
    throw AppError.conflict(ErrorCodes.CONFLICT, `Only active sprints can be completed (current: ${row.status})`);
  }
  const db = getDb();
  const ts = nowIso();

  withTransaction(() => {
    db.prepare("UPDATE sprints SET status = 'completed', completed_at = ? WHERE id = ?").run(ts, sprintId);
    // carry over: stories that did not finish return to the backlog
    const unfinished = db
      .prepare("SELECT id FROM stories WHERE sprint_id = ? AND status != 'done'")
      .all(sprintId) as Array<{ id: string }>;
    for (const s of unfinished) {
      const current = db.prepare('SELECT status FROM stories WHERE id = ?').get(s.id) as { status: string };
      db.prepare('UPDATE stories SET sprint_id = NULL, status = ?, updated_at = ? WHERE id = ?').run('backlog', ts, s.id);
      if (current.status !== 'backlog') {
        db.prepare(
          'INSERT INTO status_events (id, project_id, entity_type, entity_id, from_status, to_status, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(newId(), projectId, 'story', s.id, current.status, 'backlog', userId, ts);
      }
    }
  });

  const completedRow = getSprintRow(sprintId, projectId);
  const metrics = computeSprintMetrics(completedRow);
  db.prepare('UPDATE sprints SET metrics_snapshot = ? WHERE id = ?').run(JSON.stringify(metrics), sprintId);

  recordActivity(projectId, userId, 'sprint.completed', `Sprint "${row.name}" completed — ${metrics.donePoints}/${metrics.totalPoints} pts done`);
  notify(userId, 'sprint.completed', 'Sprint completed', `"${row.name}" finished with ${metrics.completionRate}% completion.`);
  return metrics;
}

export function getVelocity(projectId: string, userId: string): VelocityPoint[] {
  requireProject(projectId, userId);
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM sprints WHERE project_id = ? AND status IN ('completed', 'active') ORDER BY COALESCE(starts_at, created_at) ASC LIMIT 12"
    )
    .all(projectId) as unknown as SprintRow[];

  return rows.map((row) => {
    if (row.metrics_snapshot) {
      const snap = JSON.parse(row.metrics_snapshot) as SprintMetrics;
      return { sprint: row.name, sprintId: row.id, committed: snap.totalPoints, completed: snap.donePoints };
    }
    const m = computeSprintMetrics(row);
    return { sprint: row.name, sprintId: row.id, committed: m.totalPoints, completed: m.donePoints };
  });
}

// ---------- kanban board ----------

export interface BoardTask {
  id: string;
  projectId: string;
  storyId: string;
  title: string;
  description: string;
  status: BacklogStatus;
  priority: string;
  position: number;
  storyTitle: string;
  epicTitle: string | null;
  updatedAt: string;
}

export interface BoardPayload {
  tasks: BoardTask[];
  sprints: Sprint[];
  activeSprint: Sprint | null;
}

export function getBoard(projectId: string, userId: string): BoardPayload {
  requireProject(projectId, userId);
  const db = getDb();
  const tasks = db
    .prepare(
      `SELECT t.*, s.title AS story_title, e.title AS epic_title
       FROM tasks t JOIN stories s ON s.id = t.story_id LEFT JOIN epics e ON e.id = s.epic_id
       WHERE t.project_id = ? AND t.status != 'cancelled'
       ORDER BY t.position, t.created_at`
    )
    .all(projectId) as Array<{
    id: string;
    project_id: string;
    story_id: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    position: number;
    story_title: string;
    epic_title: string | null;
    updated_at: string;
  }>;

  const sprints = listSprints(projectId, userId);
  return {
    tasks: tasks.map((t) => ({
      id: t.id,
      projectId: t.project_id,
      storyId: t.story_id,
      title: t.title,
      description: t.description,
      status: t.status as BacklogStatus,
      priority: t.priority,
      position: t.position,
      storyTitle: t.story_title,
      epicTitle: t.epic_title,
      updatedAt: t.updated_at,
    })),
    sprints,
    activeSprint: sprints.find((s) => s.status === 'active') ?? null,
  };
}
