import { Router } from 'express';
import {
  addDependencySchema,
  createEpicSchema,
  createStorySchema,
  createSubtaskSchema,
  createTaskSchema,
  transitionSchema,
  updateStorySchema,
  updateTaskSchema,
} from '@devflow/shared';
import { z } from 'zod';
import { asyncHandler, parseBody, send } from '../util/http.js';
import { requireAuth } from '../middleware/auth.js';
import * as backlog from '../services/backlog.service.js';
import * as comments from '../services/comments.service.js';
import { createCommentSchema } from '@devflow/shared';

export const backlogRouter = Router();
backlogRouter.use(requireAuth);

const projectIdParam = z.object({ projectId: z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });

// ---------- tree ----------

backlogRouter.get(
  '/projects/:projectId/backlog',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    send(res, backlog.getBacklogTree(req.params.projectId!, req.userId!));
  })
);

// ---------- epics ----------

backlogRouter.post(
  '/projects/:projectId/epics',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    const input = parseBody(createEpicSchema, req.body);
    send(res, backlog.createEpic(req.params.projectId!, req.userId!, input));
  })
);

backlogRouter.patch(
  '/projects/:projectId/epics/:id',
  asyncHandler(async (req, res) => {
    const schema = z.object({ title: z.string().trim().min(2).max(160).optional(), description: z.string().max(4000).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() });
    const input = parseBody(schema, req.body);
    send(res, backlog.updateEpic(req.params.projectId!, req.params.id!, req.userId!, input));
  })
);

backlogRouter.delete(
  '/projects/:projectId/epics/:id',
  asyncHandler(async (req, res) => {
    backlog.deleteEpic(req.params.projectId!, req.params.id!, req.userId!);
    send(res, { ok: true });
  })
);

// ---------- stories ----------

backlogRouter.post(
  '/projects/:projectId/stories',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    const input = parseBody(createStorySchema, req.body);
    send(res, backlog.createStory(req.params.projectId!, req.userId!, input));
  })
);

backlogRouter.patch(
  '/projects/:projectId/stories/:id',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    const input = parseBody(updateStorySchema, req.body);
    send(res, backlog.updateStory(req.params.projectId!, req.params.id!, req.userId!, input));
  })
);

backlogRouter.delete(
  '/projects/:projectId/stories/:id',
  asyncHandler(async (req, res) => {
    backlog.deleteStory(req.params.projectId!, req.params.id!, req.userId!);
    send(res, { ok: true });
  })
);

backlogRouter.post(
  '/projects/:projectId/stories/:id/transition',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    const input = parseBody(transitionSchema, req.body);
    send(res, backlog.transitionEntity('story', req.params.projectId!, req.params.id!, req.userId!, input));
  })
);

backlogRouter.post(
  '/projects/:projectId/stories/:id/dependencies',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    const input = parseBody(addDependencySchema, req.body);
    backlog.addStoryDependency(req.params.projectId!, req.params.id!, input.dependsOnId, req.userId!);
    send(res, { ok: true });
  })
);

backlogRouter.delete(
  '/projects/:projectId/stories/:id/dependencies/:depId',
  asyncHandler(async (req, res) => {
    backlog.removeStoryDependency(req.params.projectId!, req.params.id!, req.params.depId!, req.userId!);
    send(res, { ok: true });
  })
);

// ---------- tasks ----------

backlogRouter.post(
  '/projects/:projectId/tasks',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    const input = parseBody(createTaskSchema, req.body);
    send(res, backlog.createTask(req.params.projectId!, req.userId!, input));
  })
);

backlogRouter.get(
  '/projects/:projectId/tasks/:id',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    send(res, backlog.getTaskDetail(req.params.projectId!, req.params.id!, req.userId!));
  })
);

backlogRouter.patch(
  '/projects/:projectId/tasks/:id',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    const input = parseBody(updateTaskSchema, req.body);
    send(res, backlog.updateTask(req.params.projectId!, req.params.id!, req.userId!, input));
  })
);

backlogRouter.delete(
  '/projects/:projectId/tasks/:id',
  asyncHandler(async (req, res) => {
    backlog.deleteTask(req.params.projectId!, req.params.id!, req.userId!);
    send(res, { ok: true });
  })
);

backlogRouter.post(
  '/projects/:projectId/tasks/:id/transition',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    const input = parseBody(transitionSchema, req.body);
    send(res, backlog.transitionEntity('task', req.params.projectId!, req.params.id!, req.userId!, input));
  })
);

backlogRouter.post(
  '/projects/:projectId/tasks/:id/subtasks',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    const input = parseBody(createSubtaskSchema, req.body);
    send(res, backlog.createSubtask(req.params.projectId!, req.params.id!, req.userId!, input.title));
  })
);

backlogRouter.patch(
  '/projects/:projectId/tasks/:id/subtasks/:subtaskId',
  asyncHandler(async (req, res) => {
    const input = parseBody(z.object({ title: z.string().trim().min(1).max(200).optional(), done: z.boolean().optional() }), req.body);
    backlog.updateSubtask(req.params.projectId!, req.params.id!, req.params.subtaskId!, req.userId!, input);
    send(res, { ok: true });
  })
);

backlogRouter.delete(
  '/projects/:projectId/tasks/:id/subtasks/:subtaskId',
  asyncHandler(async (req, res) => {
    backlog.deleteSubtask(req.params.projectId!, req.params.id!, req.params.subtaskId!, req.userId!);
    send(res, { ok: true });
  })
);

backlogRouter.get(
  '/projects/:projectId/tasks/:id/comments',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    send(res, comments.listComments(req.params.projectId!, req.params.id!, req.userId!));
  })
);

backlogRouter.post(
  '/projects/:projectId/tasks/:id/comments',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    const input = parseBody(createCommentSchema, req.body);
    send(res, comments.addComment(req.params.projectId!, req.params.id!, req.userId!, input.body));
  })
);

backlogRouter.delete(
  '/projects/:projectId/tasks/:id/comments/:commentId',
  asyncHandler(async (req, res) => {
    comments.deleteComment(req.params.projectId!, req.params.id!, req.params.commentId!, req.userId!);
    send(res, { ok: true });
  })
);

backlogRouter.post(
  '/projects/:projectId/tasks/:id/dependencies',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    const input = parseBody(addDependencySchema, req.body);
    backlog.addTaskDependency(req.params.projectId!, req.params.id!, input.dependsOnId, req.userId!);
    send(res, { ok: true });
  })
);

backlogRouter.delete(
  '/projects/:projectId/tasks/:id/dependencies/:depId',
  asyncHandler(async (req, res) => {
    backlog.removeTaskDependency(req.params.projectId!, req.params.id!, req.params.depId!, req.userId!);
    send(res, { ok: true });
  })
);
