/**
 * Project import — the counterpart of exportProject. Accepts a
 * devflow-project/v1 snapshot and materializes it as a NEW project with
 * fresh IDs (dependency and sprint references are remapped).
 */
import { z } from 'zod';
import { getDb, newId, nowIso, withTransaction } from '../db/database.js';
import { AppError } from '../util/appError.js';
import { ErrorCodes } from '@devflow/shared';
import { createProject } from './projects.service.js';
import { recordActivity } from './events.service.js';

const importShape = z.object({
  format: z.literal('devflow-project/v1'),
  project: z.object({
    name: z.string().min(1).max(120),
    description: z.string().max(4000).optional(),
    techStack: z.array(z.string()).optional(),
  }),
  epics: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string().optional(),
        color: z.string().optional(),
      })
    )
    .default([]),
  stories: z
    .array(
      z.object({
        id: z.string(),
        epicId: z.string().nullable().optional(),
        title: z.string(),
        description: z.string().optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
        points: z.number().optional(),
        acceptanceCriteria: z.array(z.string()).optional(),
        assigneeUserId: z.string().nullable().optional(),
        dueDate: z.string().nullable().optional(),
        sprintId: z.string().nullable().optional(),
      })
    )
    .default([]),
  tasks: z
    .array(
      z.object({
        id: z.string(),
        storyId: z.string(),
        title: z.string(),
        description: z.string().optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
        assigneeUserId: z.string().nullable().optional(),
        dueDate: z.string().nullable().optional(),
        subtasks: z
          .array(z.object({ title: z.string(), done: z.boolean().optional() }))
          .optional(),
      })
    )
    .default([]),
  sprints: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        goal: z.string().optional(),
        status: z.string().optional(),
        startsAt: z.string().nullable().optional(),
        endsAt: z.string().nullable().optional(),
        completedAt: z.string().nullable().optional(),
        committedPoints: z.number().nullable().optional(),
        completedPoints: z.number().nullable().optional(),
      })
    )
    .default([]),
  dependencies: z
    .object({
      stories: z.array(z.tuple([z.string(), z.string()])).optional(),
      tasks: z.array(z.tuple([z.string(), z.string()])).optional(),
    })
    .optional(),
});

export type ImportResult = {
  projectId: string;
  counts: { epics: number; stories: number; tasks: number; subtasks: number; sprints: number };
};

export function importProject(
  userId: string,
  workspaceId: string,
  input: { name?: string; data?: unknown }
): ImportResult {
  const parsed = importShape.safeParse(input.data);
  if (!parsed.success) {
    throw new AppError(422, ErrorCodes.VALIDATION_FAILED, 'Import file is not a valid devflow-project/v1 export', {
      issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const data = parsed.data;

  const project = createProject(userId, {
    name: (input.name ?? data.project.name).slice(0, 120),
    description: data.project.description ?? '',
    techStack: (data.project.techStack ?? []).slice(0, 20),
  });
  const projectId = project.id;
  void workspaceId;

  const db = getDb();
  const ts = nowIso();
  const counts = { epics: 0, stories: 0, tasks: 0, subtasks: 0, sprints: 0 };

  withTransaction(() => {
    const epicMap = new Map<string, string>();
    for (const e of data.epics) {
      const id = newId();
      epicMap.set(e.id, id);
      db.prepare(
        'INSERT INTO epics (id, project_id, title, description, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(id, projectId, e.title, e.description ?? '', e.color ?? '#6E7BFF', counts.epics, ts, ts);
      counts.epics++;
    }

    const sprintMap = new Map<string, string>();
    for (const sp of data.sprints) {
      const id = newId();
      sprintMap.set(sp.id, id);
      const status = ['planned', 'active', 'completed', 'cancelled'].includes(sp.status ?? '')
        ? (sp.status as string)
        : 'planned';
      db.prepare(
        'INSERT INTO sprints (id, project_id, name, goal, status, starts_at, ends_at, created_at, completed_at, metrics_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        id,
        projectId,
        sp.name,
        sp.goal ?? '',
        status,
        sp.startsAt ?? null,
        sp.endsAt ?? null,
        ts,
        sp.completedAt ?? null,
        // preserve committed/completed points when the export carried a snapshot
        sp.committedPoints != null && sp.completedPoints != null
          ? JSON.stringify({
              sprint: { id, name: sp.name, goal: sp.goal ?? '', status, startsAt: sp.startsAt ?? null, endsAt: sp.endsAt ?? null, createdAt: ts, completedAt: sp.completedAt ?? null },
              totalPoints: sp.committedPoints,
              donePoints: sp.completedPoints,
              totalStories: 0,
              doneStories: 0,
              openTasks: 0,
              burndown: [],
              completionRate: sp.committedPoints > 0 ? Math.round((sp.completedPoints / sp.committedPoints) * 100) : 0,
            })
          : null
      );
      counts.sprints++;
    }

    const storyMap = new Map<string, string>();
    for (const st of data.stories) {
      const id = newId();
      storyMap.set(st.id, id);
      const status = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'].includes(st.status ?? '')
        ? (st.status as string)
        : 'backlog';
      const priority = ['low', 'medium', 'high', 'critical'].includes(st.priority ?? '')
        ? (st.priority as string)
        : 'medium';
      db.prepare(
        'INSERT INTO stories (id, project_id, epic_id, sprint_id, title, description, status, priority, points, position, acceptance_criteria, assignee_user_id, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        id,
        projectId,
        st.epicId ? (epicMap.get(st.epicId) ?? null) : null,
        st.sprintId ? (sprintMap.get(st.sprintId) ?? null) : null,
        st.title,
        st.description ?? '',
        status,
        priority,
        Math.max(0, Math.min(100, Math.round(st.points ?? 3))),
        counts.stories,
        JSON.stringify((st.acceptanceCriteria ?? []).slice(0, 20)),
        null, // assignees are workspace-scoped — imported stories start unassigned
        st.dueDate ?? null,
        ts,
        ts
      );
      counts.stories++;
    }

    for (const t of data.tasks) {
      const mappedStory = storyMap.get(t.storyId);
      if (!mappedStory) continue; // orphaned task in a malformed export
      const id = newId();
      const status = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'].includes(t.status ?? '')
        ? (t.status as string)
        : 'todo';
      const priority = ['low', 'medium', 'high', 'critical'].includes(t.priority ?? '')
        ? (t.priority as string)
        : 'medium';
      db.prepare(
        'INSERT INTO tasks (id, project_id, story_id, title, description, status, priority, position, assignee_user_id, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        id,
        projectId,
        mappedStory,
        t.title,
        t.description ?? '',
        status,
        priority,
        counts.tasks,
        null,
        t.dueDate ?? null,
        ts,
        ts
      );
      counts.tasks++;
      let pos = 0;
      for (const sub of t.subtasks ?? []) {
        db.prepare('INSERT INTO subtasks (id, task_id, title, done, position) VALUES (?, ?, ?, ?, ?)').run(
          newId(),
          id,
          sub.title.slice(0, 200),
          sub.done ? 1 : 0,
          pos++
        );
        counts.subtasks++;
      }
    }

    // dependencies (remapped, cycle-tolerant: INSERT OR IGNORE, cycles were
    // rejected at creation time in the source project)
    const storyDeps = data.dependencies?.stories ?? [];
    for (const [from, to] of storyDeps) {
      const a = storyMap.get(from);
      const b = storyMap.get(to);
      if (a && b && a !== b) {
        db.prepare('INSERT OR IGNORE INTO story_dependencies (story_id, depends_on_story_id) VALUES (?, ?)').run(a, b);
      }
    }
    const taskDeps = data.dependencies?.tasks ?? [];
    for (const [from, to] of taskDeps) {
      // task id maps 1:1 to the same new id namespace
      if (from !== to) {
        db.prepare('INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)').run(from, to);
      }
    }
  });

  recordActivity(projectId, userId, 'project.imported', `Project imported — ${counts.stories} stories, ${counts.tasks} tasks, ${counts.sprints} sprints`);
  return { projectId, counts };
}
