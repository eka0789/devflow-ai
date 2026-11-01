/** Cross-project search — ownership-scoped, LIKE-based with escaped wildcards. */
import { getDb } from '../db/database.js';
import { requireProject } from './projects.service.js';
import type { Project, SearchResults, Story, Task } from '@devflow/shared';

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
  created_at: string;
  updated_at: string;
}

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

  const projects = db
    .prepare(
      `SELECT * FROM projects WHERE owner_user_id = ? AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')
       ORDER BY updated_at DESC LIMIT ?`
    )
    .all(userId, pattern, pattern, cap) as unknown as Project[];

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

  return { projects, stories: storyRows as unknown as Story[], tasks: taskRows as unknown as Task[] };
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
