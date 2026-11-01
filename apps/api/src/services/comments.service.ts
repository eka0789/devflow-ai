/** Task comments — discussion thread scoped to a project and task. */
import { getDb, newId, nowIso } from '../db/database.js';
import { AppError } from '../util/appError.js';
import { recordActivity } from './events.service.js';
import { requireProject } from './projects.service.js';
import type { Comment } from '@devflow/shared';

interface CommentRow {
  id: string;
  task_id: string;
  project_id: string;
  user_id: string;
  body: string;
  created_at: string;
  user_name?: string | null;
}

function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    taskId: row.task_id,
    projectId: row.project_id,
    userId: row.user_id,
    userName: row.user_name ?? null,
    body: row.body,
    createdAt: row.created_at,
  };
}

function assertTask(projectId: string, taskId: string, userId: string): void {
  requireProject(projectId, userId);
  const task = getDb()
    .prepare('SELECT id FROM tasks WHERE id = ? AND project_id = ?')
    .get(taskId, projectId);
  if (!task) throw AppError.notFound('Task');
}

export function listComments(projectId: string, taskId: string, userId: string): Comment[] {
  assertTask(projectId, taskId, userId);
  const rows = getDb()
    .prepare(
      `SELECT c.*, u.name AS user_name FROM comments c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.task_id = ? ORDER BY c.created_at, c.rowid LIMIT 500`
    )
    .all(taskId) as unknown as CommentRow[];
  return rows.map(toComment);
}

export function addComment(
  projectId: string,
  taskId: string,
  userId: string,
  body: string
): Comment {
  assertTask(projectId, taskId, userId);
  const db = getDb();
  const id = newId();
  db.prepare(
    'INSERT INTO comments (id, task_id, project_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, taskId, projectId, userId, body, nowIso());
  const taskTitle = (
    db.prepare('SELECT title FROM tasks WHERE id = ?').get(taskId) as { title: string }
  ).title;
  recordActivity(projectId, userId, 'task.commented', `Commented on task "${taskTitle.slice(0, 60)}"`);
  return toComment(
    db
      .prepare(
        'SELECT c.*, u.name AS user_name FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?'
      )
      .get(id) as unknown as CommentRow
  );
}

export function deleteComment(projectId: string, taskId: string, commentId: string, userId: string): void {
  assertTask(projectId, taskId, userId);
  const row = getDb()
    .prepare('SELECT * FROM comments WHERE id = ? AND task_id = ?')
    .get(commentId, taskId) as CommentRow | undefined;
  if (!row) throw AppError.notFound('Comment');
  if (row.user_id !== userId) {
    throw AppError.notFound('Comment'); // do not reveal other users' comment ids
  }
  getDb().prepare('DELETE FROM comments WHERE id = ?').run(commentId);
}
