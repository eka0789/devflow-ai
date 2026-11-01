import { Router } from 'express';
import { createProjectSchema, updateProjectSchema } from '@devflow/shared';
import { asyncHandler, parseBody, send } from '../util/http.js';
import { requireAuth } from '../middleware/auth.js';
import * as projects from '../services/projects.service.js';

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

projectsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    send(res, projects.listProjects(req.userId!));
  })
);

projectsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parseBody(createProjectSchema, req.body);
    send(res, projects.createProject(req.userId!, input));
  })
);

projectsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    send(res, projects.requireProject(req.params.id!, req.userId!));
  })
);

projectsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = parseBody(updateProjectSchema, req.body);
    const id = req.params.id!;
    send(res, projects.updateProject(id, req.userId!, input));
  })
);

projectsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    projects.deleteProject(req.params.id!, req.userId!);
    send(res, { ok: true });
  })
);

projectsRouter.get(
  '/:id/activity',
  asyncHandler(async (req, res) => {
    const limit = Math.min(100, Number(req.query.limit ?? 50));
    send(res, projects.listActivity(req.params.id!, req.userId!, limit));
  })
);
