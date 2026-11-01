import { Router } from 'express';
import { createProjectSchema, updateProjectSchema } from '@devflow/shared';
import { asyncHandler, parseBody, parsePositiveInt, send } from '../util/http.js';
import { requireAuth } from '../middleware/auth.js';
import * as projects from '../services/projects.service.js';

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

projectsRouter.get(
  '/projects',
  asyncHandler(async (req, res) => {
    send(res, projects.listProjects(req.userId!));
  })
);

projectsRouter.post(
  '/projects',
  asyncHandler(async (req, res) => {
    const input = parseBody(createProjectSchema, req.body);
    send(res, projects.createProject(req.userId!, input));
  })
);

projectsRouter.get(
  '/projects/:id',
  asyncHandler(async (req, res) => {
    send(res, projects.getProject(req.params.id!, req.userId!));
  })
);

projectsRouter.patch(
  '/projects/:id',
  asyncHandler(async (req, res) => {
    const input = parseBody(updateProjectSchema, req.body);
    const id = req.params.id!;
    send(res, projects.updateProject(id, req.userId!, input));
  })
);

projectsRouter.delete(
  '/projects/:id',
  asyncHandler(async (req, res) => {
    projects.deleteProject(req.params.id!, req.userId!);
    send(res, { ok: true });
  })
);

projectsRouter.get(
  '/projects/:id/export',
  asyncHandler(async (req, res) => {
    send(res, projects.exportProject(req.params.id!, req.userId!));
  })
);

projectsRouter.get(
  '/projects/:id/activity',
  asyncHandler(async (req, res) => {
    const limit = parsePositiveInt(req.query.limit, 50, 100);
    send(res, projects.listActivity(req.params.id!, req.userId!, limit));
  })
);
