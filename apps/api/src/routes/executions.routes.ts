import { Router } from 'express';
import { z } from 'zod';
import { executeTaskSchema } from '@devflow/shared';
import { asyncHandler, parseBody, send } from '../util/http.js';
import { requireAuth } from '../middleware/auth.js';
import * as pipeline from '../services/execution/pipeline.js';
import { getExecutionStats } from '../services/analytics.service.js';

export const executionsRouter = Router();
executionsRouter.use(requireAuth);

const projectIdParam = z.object({ projectId: z.string().uuid() });
const executionParams = z.object({ projectId: z.string().uuid(), id: z.string().uuid() });

// Start an execution for a task
executionsRouter.post(
  '/tasks/:taskId/execute',
  asyncHandler(async (req, res) => {
    const input = parseBody(executeTaskSchema, req.body ?? {});
    const taskId = z.string().uuid().parse(req.params.taskId);
    send(res, pipeline.startExecution(taskId, req.userId!, input.createPR ?? true));
  })
);

executionsRouter.get(
  '/projects/:projectId/executions',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    const limit = Math.min(100, Number(req.query.limit ?? 30));
    send(res, pipeline.listExecutions(req.params.projectId!, req.userId!, limit));
  })
);

executionsRouter.get(
  '/projects/:projectId/executions/:id',
  asyncHandler(async (req, res) => {
    parseBody(executionParams, req.params);
    send(res, pipeline.getExecution(req.params.projectId!, req.params.id!, req.userId!));
  })
);

executionsRouter.get(
  '/projects/:projectId/executions/:id/diff',
  asyncHandler(async (req, res) => {
    parseBody(executionParams, req.params);
    send(res, { diff: pipeline.getExecutionDiff(req.params.projectId!, req.params.id!, req.userId!) });
  })
);

executionsRouter.post(
  '/executions/:id/cancel',
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    send(res, pipeline.cancelExecution(id, req.userId!));
  })
);

executionsRouter.get(
  '/executions/stats',
  asyncHandler(async (req, res) => {
    const projectId = typeof req.query.projectId === 'string' && req.query.projectId ? req.query.projectId : null;
    if (projectId) z.string().uuid().parse(projectId);
    send(res, getExecutionStats(req.userId!, projectId));
  })
);
