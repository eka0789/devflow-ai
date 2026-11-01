/** Project labels — colored tags attachable to stories and tasks. */
import { getDb, newId, nowIso } from '../db/database.js';
import { AppError } from '../util/appError.js';
import { requireProject, requireProjectWrite } from './projects.service.js';
import type { Label } from '@devflow/shared';

interface LabelRow {
  id: string;
  project_id: string;
  name: string;
  color: string;
  created_at: string;
}

function toLabel(row: LabelRow): Label {
  return { id: row.id, projectId: row.project_id, name: row.name, color: row.color, createdAt: row.created_at };
}

export function listLabels(projectId: string, userId: string): Label[] {
  requireProject(projectId, userId);
  const rows = getDb()
    .prepare('SELECT * FROM labels WHERE project_id = ? ORDER BY name')
    .all(projectId) as unknown as LabelRow[];
  return rows.map(toLabel);
}

export function createLabel(projectId: string, userId: string, name: string, color: string): Label {
  requireProjectWrite(projectId, userId);
  const dupe = getDb()
    .prepare('SELECT id FROM labels WHERE project_id = ? AND lower(name) = lower(?)')
    .get(projectId, name);
  if (dupe) throw AppError.conflict('CONFLICT', `Label "${name}" already exists`);
  const id = newId();
  getDb()
    .prepare('INSERT INTO labels (id, project_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, projectId, name, color, nowIso());
  return toLabel(getDb().prepare('SELECT * FROM labels WHERE id = ?').get(id) as unknown as LabelRow);
}

export function updateLabel(
  projectId: string,
  labelId: string,
  userId: string,
  input: { name?: string; color?: string }
): Label {
  requireProjectWrite(projectId, userId);
  const row = getDb()
    .prepare('SELECT * FROM labels WHERE id = ? AND project_id = ?')
    .get(labelId, projectId) as unknown as LabelRow | undefined;
  if (!row) throw AppError.notFound('Label');
  getDb()
    .prepare('UPDATE labels SET name = ?, color = ? WHERE id = ?')
    .run(input.name ?? row.name, input.color ?? row.color, labelId);
  return toLabel(getDb().prepare('SELECT * FROM labels WHERE id = ?').get(labelId) as unknown as LabelRow);
}

export function deleteLabel(projectId: string, labelId: string, userId: string): void {
  requireProjectWrite(projectId, userId);
  const res = getDb()
    .prepare('DELETE FROM labels WHERE id = ? AND project_id = ?')
    .run(labelId, projectId);
  if (res.changes === 0) throw AppError.notFound('Label');
}

/** Replaces the label set on a story (used by story create/update). */
export function setStoryLabels(projectId: string, storyId: string, labelIds: string[]): void {
  const db = getDb();
  db.prepare('DELETE FROM story_labels WHERE story_id = ?').run(storyId);
  for (const labelId of labelIds) {
    const known = db.prepare('SELECT id FROM labels WHERE id = ? AND project_id = ?').get(labelId, projectId);
    if (!known) throw AppError.notFound('Label');
    db.prepare('INSERT OR IGNORE INTO story_labels (story_id, label_id) VALUES (?, ?)').run(storyId, labelId);
  }
}

export function setTaskLabels(projectId: string, taskId: string, labelIds: string[]): void {
  const db = getDb();
  db.prepare('DELETE FROM task_labels WHERE task_id = ?').run(taskId);
  for (const labelId of labelIds) {
    const known = db.prepare('SELECT id FROM labels WHERE id = ? AND project_id = ?').get(labelId, projectId);
    if (!known) throw AppError.notFound('Label');
    db.prepare('INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)').run(taskId, labelId);
  }
}

export function labelsForStory(storyId: string): Label[] {
  return getDb()
    .prepare(
      'SELECT l.* FROM story_labels sl JOIN labels l ON l.id = sl.label_id WHERE sl.story_id = ? ORDER BY l.name'
    )
    .all(storyId) as unknown as Label[];
}

export function labelsForTask(taskId: string): Label[] {
  return getDb()
    .prepare(
      'SELECT l.* FROM task_labels tl JOIN labels l ON l.id = tl.label_id WHERE tl.task_id = ? ORDER BY l.name'
    )
    .all(taskId) as unknown as Label[];
}
