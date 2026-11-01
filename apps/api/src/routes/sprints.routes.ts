import { Router } from 'express';
import { createSprintSchema, updateSprintSchema } from '@devflow/shared';
import { z } from 'zod';
import { asyncHandler, parseBody, send } from '../util/http.js';
import { requireAuth } from '../middleware/auth.js';
import * as sprints from '../services/sprints.service.js';
import * as agents from '../services/ai/agents.service.js';

export const sprintsRouter = Router();
sprintsRouter.use(requireAuth);

const projectIdParam = z.object({ projectId: z.string().uuid() });
const sprintIdParam = z.object({ projectId: z.string().uuid(), id: z.string().uuid() });

sprintsRouter.get(
  '/projects/:projectId/sprints',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    send(res, sprints.listSprints(req.params.projectId!, req.userId!));
  })
);

sprintsRouter.post(
  '/projects/:projectId/sprints',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    const input = parseBody(createSprintSchema, req.body);
    send(res, sprints.createSprint(req.params.projectId!, req.userId!, input));
  })
);

sprintsRouter.patch(
  '/projects/:projectId/sprints/:id',
  asyncHandler(async (req, res) => {
    parseBody(sprintIdParam, req.params);
    const input = parseBody(updateSprintSchema, req.body);
    send(res, sprints.updateSprint(req.params.projectId!, req.params.id!, req.userId!, input));
  })
);

sprintsRouter.post(
  '/projects/:projectId/sprints/:id/activate',
  asyncHandler(async (req, res) => {
    parseBody(sprintIdParam, req.params);
    send(res, sprints.activateSprint(req.params.projectId!, req.params.id!, req.userId!));
  })
);

sprintsRouter.post(
  '/projects/:projectId/sprints/:id/complete',
  asyncHandler(async (req, res) => {
    parseBody(sprintIdParam, req.params);
    send(res, sprints.completeSprint(req.params.projectId!, req.params.id!, req.userId!));
  })
);

sprintsRouter.post(
  '/projects/:projectId/sprints/:id/stories',
  asyncHandler(async (req, res) => {
    parseBody(sprintIdParam, req.params);
    const input = parseBody(z.object({ storyId: z.string().uuid() }), req.body);
    sprints.assignStory(req.params.projectId!, req.params.id!, input.storyId, req.userId!);
    send(res, { ok: true });
  })
);

sprintsRouter.delete(
  '/projects/:projectId/sprints/:id/stories/:storyId',
  asyncHandler(async (req, res) => {
    parseBody(sprintIdParam, req.params);
    sprints.unassignStory(req.params.projectId!, req.params.id!, req.params.storyId!, req.userId!);
    send(res, { ok: true });
  })
);

sprintsRouter.post(
  '/projects/:projectId/sprints/:id/review',
  asyncHandler(async (req, res) => {
    parseBody(sprintIdParam, req.params);
    send(res, agents.startSprintReview(req.params.projectId!, req.params.id!, req.userId!));
  })
);

sprintsRouter.get(
  '/projects/:projectId/sprints/:id/metrics',
  asyncHandler(async (req, res) => {
    parseBody(sprintIdParam, req.params);
    send(res, sprints.getSprintMetrics(req.params.projectId!, req.params.id!, req.userId!));
  })
);

sprintsRouter.get(
  '/projects/:projectId/velocity',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    send(res, sprints.getVelocity(req.params.projectId!, req.userId!));
  })
);

sprintsRouter.get(
  '/projects/:projectId/board',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    send(res, sprints.getBoard(req.params.projectId!, req.userId!));
  })
);
