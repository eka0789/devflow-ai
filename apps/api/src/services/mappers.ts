/**
 * Shared row→contract mappers (A3) and the single reader for the frozen
 * sprint metrics snapshot (A4). Row shapes are the sqlite snake_case rows;
 * the casts live here so every consumer maps identically.
 */
import type { Project, SprintMetrics, Story, Task } from '@devflow/shared';

export interface ProjectRow {
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

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerId: row.owner_user_id,
    name: row.name,
    description: row.description,
    status: row.status as Project['status'],
    techStack: JSON.parse(row.tech_stack) as string[],
    repoFullName: row.repo_full_name,
    repoDefaultBranch: row.repo_default_branch,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface StoryRow {
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

export function toStory(row: StoryRow): Story {
  return {
    id: row.id,
    projectId: row.project_id,
    epicId: row.epic_id,
    sprintId: row.sprint_id,
    title: row.title,
    description: row.description,
    status: row.status as Story['status'],
    priority: row.priority as Story['priority'],
    points: row.points,
    position: row.position,
    acceptanceCriteria: JSON.parse(row.acceptance_criteria) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface TaskRow {
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

export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    storyId: row.story_id,
    title: row.title,
    description: row.description,
    status: row.status as Task['status'],
    priority: row.priority as Task['priority'],
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Frozen sprint metrics snapshot — parsed in exactly one place. */
export function readSprintSnapshot(row: { metrics_snapshot: string | null }): SprintMetrics | null {
  if (!row.metrics_snapshot) return null;
  try {
    return JSON.parse(row.metrics_snapshot) as SprintMetrics;
  } catch {
    return null;
  }
}
