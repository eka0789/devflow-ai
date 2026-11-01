/** Client-side view models for composite API payloads. */
import type { Comment, Epic, Sprint, Story, Subtask, Task } from '@devflow/shared';

export interface BacklogTree {
  epics: Epic[];
  stories: Story[];
  tasks: Task[];
  subtasks: Subtask[];
  dependencies: {
    stories: Array<[string, string]>; // [storyId, dependsOnStoryId]
    tasks: Array<[string, string]>; // [taskId, dependsOnTaskId]
  };
}

export interface BoardTask extends Task {
  storyTitle: string;
  epicTitle: string | null;
}

export interface BoardPayload {
  tasks: BoardTask[];
  sprints: Sprint[];
  activeSprint: Sprint | null;
}

export interface TaskDetailPayload {
  task: Task;
  story: Story;
  subtasks: Subtask[];
  dependencies: Array<[string, string]>; // [taskId, dependsOnTaskId]
  comments: Comment[];
}

function asPairs(raw: unknown, selfKey: string, depKey: string): Array<[string, string]> {
  if (!Array.isArray(raw)) return [];
  const out: Array<[string, string]> = [];
  for (const entry of raw) {
    if (Array.isArray(entry) && entry.length >= 2 && typeof entry[0] === 'string' && typeof entry[1] === 'string') {
      out.push([entry[0]!, entry[1]!]);
    } else if (entry && typeof entry === 'object') {
      const o = entry as Record<string, unknown>;
      const self = o[selfKey];
      const dep = o[depKey];
      if (typeof self === 'string' && typeof dep === 'string') out.push([self, dep]);
    }
  }
  return out;
}

export function normalizeBacklogTree(raw: unknown): BacklogTree {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const deps = (obj.dependencies ?? {}) as Record<string, unknown>;
  return {
    epics: Array.isArray(obj.epics) ? (obj.epics as Epic[]) : [],
    stories: Array.isArray(obj.stories) ? (obj.stories as Story[]) : [],
    tasks: Array.isArray(obj.tasks) ? (obj.tasks as Task[]) : [],
    subtasks: Array.isArray(obj.subtasks) ? (obj.subtasks as Subtask[]) : [],
    dependencies: {
      stories: asPairs(deps.stories, 'storyId', 'dependsOnStoryId'),
      tasks: asPairs(deps.tasks, 'taskId', 'dependsOnTaskId'),
    },
  };
}

export function normalizeTaskDetail(raw: unknown): TaskDetailPayload {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    task: obj.task as Task,
    story: obj.story as Story,
    subtasks: Array.isArray(obj.subtasks) ? (obj.subtasks as Subtask[]) : [],
    dependencies: asPairs(obj.dependencies, 'taskId', 'dependsOnTaskId'),
    comments: Array.isArray(obj.comments) ? (obj.comments as Comment[]) : [],
  };
}
