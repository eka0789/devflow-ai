/** Cross-project search — ownership-scoped, LIKE-based with escaped wildcards. */
import { getDb } from '../db/database.js';
import { requireProject } from './projects.service.js';
import { toProject, toStory, toTask, type ProjectRow, type StoryRow, type TaskRow } from './mappers.js';
import type { Project, SearchResults, Story, Task } from '@devflow/shared';

/** Escapes LIKE wildcards so user input matches literally. */
function likePattern(q: string): string {
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${escaped}%`;
}

export function searchAll(userId: string, rawQuery: string, limitPerType = 8): SearchResults {
  const q = rawQuery.trim();
  if (q.length === 0) {
    return { projects: [], stories: [], tasks: [] };
  }
  const db = getDb();
  const pattern = likePattern(q);
  const cap = Math.min(25, Math.max(1, limitPerType));

  const projectRows = db
    .prepare(
      `SELECT * FROM projects WHERE owner_user_id = ? AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')
       ORDER BY updated_at DESC LIMIT ?`
    )
    .all(userId, pattern, pattern, cap) as unknown as ProjectRow[];

  const storyRows = db
    .prepare(
      `SELECT s.* FROM stories s JOIN projects p ON p.id = s.project_id
       WHERE p.owner_user_id = ? AND (s.title LIKE ? ESCAPE '\\' OR s.description LIKE ? ESCAPE '\\')
       ORDER BY s.updated_at DESC LIMIT ?`
    )
    .all(userId, pattern, pattern, cap) as unknown as StoryRow[];

  const taskRows = db
    .prepare(
      `SELECT t.* FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE p.owner_user_id = ? AND (t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')
       ORDER BY t.updated_at DESC LIMIT ?`
    )
    .all(userId, pattern, pattern, cap) as unknown as TaskRow[];

  return {
    projects: projectRows.map(toProject),
    stories: storyRows.map(toStory),
    tasks: taskRows.map(toTask),
  };
}

/** Validates search access to a project (kept for future scoped search). */
export function canSearchProject(projectId: string, userId: string): boolean {
  try {
    requireProject(projectId, userId);
    return true;
  } catch {
    return false;
  }
}
