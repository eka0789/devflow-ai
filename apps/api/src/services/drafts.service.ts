/**
 * Planning drafts. AI output always lands here first; nothing touches the
 * real backlog until the user approves. Backlog approval creates real
 * epics/stories/tasks in one transaction with dependency resolution.
 */
import { z } from 'zod';
import { getDb, newId, nowIso, withTransaction } from '../db/database.js';
import { AppError } from '../util/appError.js';
import { ErrorCodes } from '@devflow/shared';
import { backlogProposalSchema } from './ai/agents.service.js';
import { recordActivity } from './events.service.js';
import { requireProject } from './projects.service.js';
import type { Draft, DraftStatus, DraftType } from '@devflow/shared';

interface DraftRow {
  id: string;
  project_id: string;
  user_id: string;
  type: string;
  title: string;
  content: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function toDraft(row: DraftRow): Draft {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    type: row.type as DraftType,
    title: row.title,
    content: row.content,
    status: row.status as DraftStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getDraftRow(draftId: string, projectId: string): DraftRow {
  const row = getDb()
    .prepare('SELECT * FROM drafts WHERE id = ? AND project_id = ?')
    .get(draftId, projectId) as unknown as unknown as DraftRow | undefined;
  if (!row) throw AppError.notFound('Draft');
  return row;
}

export function listDrafts(projectId: string, userId: string, type: string | null): Draft[] {
  requireProject(projectId, userId);
  const rows = (
    type
      ? getDb().prepare('SELECT * FROM drafts WHERE project_id = ? AND type = ? ORDER BY created_at DESC LIMIT 100').all(projectId, type)
      : getDb().prepare('SELECT * FROM drafts WHERE project_id = ? ORDER BY created_at DESC LIMIT 100').all(projectId)
  ) as unknown as DraftRow[];
  return rows.map(toDraft);
}

export function getDraft(projectId: string, draftId: string, userId: string): Draft {
  requireProject(projectId, userId);
  return toDraft(getDraftRow(draftId, projectId));
}

export function rejectDraft(projectId: string, draftId: string, userId: string): Draft {
  requireProject(projectId, userId);
  const row = getDraftRow(draftId, projectId);
  if (row.status !== 'draft') {
    throw AppError.conflict(ErrorCodes.CONFLICT, `Draft is already ${row.status}`);
  }
  getDb().prepare("UPDATE drafts SET status = 'rejected', updated_at = ? WHERE id = ?").run(nowIso(), draftId);
  return toDraft(getDraftRow(draftId, projectId));
}

export interface ApproveResult {
  draft: Draft;
  created?: { epics: number; stories: number; tasks: number; subtasks: number };
}

export function approveDraft(projectId: string, draftId: string, userId: string, createRecords: boolean): ApproveResult {
  requireProject(projectId, userId);
  const row = getDraftRow(draftId, projectId);
  if (row.status !== 'draft') {
    throw AppError.conflict(ErrorCodes.CONFLICT, `Draft is already ${row.status}`);
  }

  if (row.type !== 'backlog' || !createRecords) {
    getDb().prepare("UPDATE drafts SET status = 'approved', updated_at = ? WHERE id = ?").run(nowIso(), draftId);
    recordActivity(projectId, userId, 'draft.approved', `"${row.title}" approved`);
    return { draft: toDraft(getDraftRow(draftId, projectId)) };
  }

  // validate again before mutating anything
  const proposal = backlogProposalSchema.safeParse(JSON.parse(row.content));
  if (!proposal.success) {
    throw new AppError(
      422,
      ErrorCodes.VALIDATION_FAILED,
      'Draft content failed schema validation and cannot be applied',
      proposal.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message }))
    );
  }

  const counts = withTransaction(() => applyBacklogProposal(projectId, userId, proposal.data));
  getDb().prepare("UPDATE drafts SET status = 'approved', updated_at = ? WHERE id = ?").run(nowIso(), draftId);
  recordActivity(
    projectId,
    userId,
    'draft.approved',
    `Backlog proposal approved — ${counts.epics} epics, ${counts.stories} stories, ${counts.tasks} tasks created`
  );
  return { draft: toDraft(getDraftRow(draftId, projectId)), created: counts };
}

function applyBacklogProposal(
  projectId: string,
  userId: string,
  proposal: z.infer<typeof backlogProposalSchema>
): { epics: number; stories: number; tasks: number; subtasks: number } {
  const db = getDb();
  const ts = nowIso();
  let epicCount = 0;
  let storyCount = 0;
  let taskCount = 0;
  let subtaskCount = 0;

  const storyIdByTitle = new Map<string, string>();

  for (const epic of proposal.epics) {
    // reuse an existing epic with the same title instead of duplicating
    const existing = db.prepare('SELECT id FROM epics WHERE project_id = ? AND title = ?').get(projectId, epic.title) as { id: string } | undefined;
    const epicId = existing?.id ?? newId();
    if (!existing) {
      const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM epics WHERE project_id = ?').get(projectId) as { p: number };
      db.prepare(
        'INSERT INTO epics (id, project_id, title, description, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(epicId, projectId, epic.title, epic.description, '#6E7BFF', maxPos.p + 1, ts, ts);
      epicCount++;
    }

    for (const story of epic.stories) {
      const storyId = newId();
      storyIdByTitle.set(story.title, storyId);
      db.prepare(
        'INSERT INTO stories (id, project_id, epic_id, sprint_id, title, description, status, priority, points, position, acceptance_criteria, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        storyId,
        projectId,
        epicId,
        story.title,
        story.description,
        'backlog',
        story.priority,
        story.points,
        storyCount,
        JSON.stringify(story.acceptanceCriteria),
        ts,
        ts
      );
      storyCount++;

      for (const task of story.tasks) {
        const taskId = newId();
        db.prepare(
          'INSERT INTO tasks (id, project_id, story_id, title, description, status, priority, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(taskId, projectId, storyId, task.title, task.description, 'todo', story.priority, taskCount, ts, ts);
        taskCount++;

        for (const st of task.subtasks) {
          db.prepare('INSERT INTO subtasks (id, task_id, title, done, position) VALUES (?, ?, ?, 0, ?)').run(newId(), taskId, st, subtaskCount);
          subtaskCount++;
        }
      }
    }
  }

  // second pass: resolve story-level dependencies by title
  let depCursor = 0;
  for (const epic of proposal.epics) {
    for (const story of epic.stories) {
      const storyId = storyIdByTitle.get(story.title);
      if (!storyId) continue;
      for (const depTitle of story.dependencies) {
        const depId = storyIdByTitle.get(depTitle);
        if (depId && depId !== storyId) {
          db.prepare('INSERT OR IGNORE INTO story_dependencies (story_id, depends_on_story_id) VALUES (?, ?)').run(storyId, depId);
          depCursor++;
        }
      }
    }
  }
  void depCursor;

  return { epics: epicCount, stories: storyCount, tasks: taskCount, subtasks: subtaskCount };
}
