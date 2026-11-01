/** Wave 3 routes: workspace roster, labels, my-work, roadmap, import, outgoing webhooks. */
import { Router } from 'express';
import { z } from 'zod';
import {
  createLabelSchema,
  createOutgoingWebhookSchema,
  inviteMemberSchema,
  setLabelsSchema,
  updateMemberSchema,
  updateOutgoingWebhookSchema,
} from '@devflow/shared';
import { asyncHandler, parseBody, parsePositiveInt, send } from '../util/http.js';
import { requireAuth } from '../middleware/auth.js';
import { getMyWork } from '../services/analytics.service.js';
import { getRoadmap } from '../services/sprints.service.js';
import { importProject } from '../services/import.service.js';
import { getDb } from '../db/database.js';
import { AppError } from '../util/appError.js';
import * as workspace from '../services/workspace.service.js';
import * as labels from '../services/labels.service.js';
import * as outgoing from '../services/outgoing-webhooks.service.js';

export const wave3Router = Router();
wave3Router.use(requireAuth);

/** The workspace the user administers (membership first, own workspace fallback). */
function resolveUserWorkspace(userId: string): { id: string } {
  const membership = getDb()
    .prepare('SELECT workspace_id AS id FROM workspace_members WHERE user_id = ? ORDER BY created_at LIMIT 1')
    .get(userId) as { id: string } | undefined;
  if (membership) return membership;
  const own = getDb()
    .prepare('SELECT id FROM workspaces WHERE owner_user_id = ? ORDER BY created_at LIMIT 1')
    .get(userId) as { id: string } | undefined;
  if (!own) throw AppError.notFound('Workspace');
  return own;
}

// ---------- my work ----------
wave3Router.get(
  '/my-work',
  asyncHandler(async (req, res) => {
    send(res, getMyWork(req.userId!));
  })
);

// ---------- workspace roster ----------
wave3Router.get(
  '/workspace/roster',
  asyncHandler(async (req, res) => {
    const user = getDb().prepare('SELECT id FROM users WHERE id = ?').get(req.userId!);
    if (!user) throw AppError.notFound('User');
    const ws = resolveUserWorkspace(req.userId!);
    send(res, workspace.getRoster(ws.id, req.userId!));
  })
);

wave3Router.post(
  '/workspace/invites',
  asyncHandler(async (req, res) => {
    const input = parseBody(inviteMemberSchema, req.body);
    const ws = getDb()
      .prepare('SELECT id FROM workspaces WHERE owner_user_id = ? ORDER BY created_at LIMIT 1')
      .get(req.userId!) as { id: string } | undefined;
    if (!ws) throw AppError.notFound('Workspace');
    send(res, workspace.inviteMember(ws.id, req.userId!, input.email, input.role));
  })
);

wave3Router.delete(
  '/workspace/invites/:id',
  asyncHandler(async (req, res) => {
    const ws = getDb()
      .prepare('SELECT id FROM workspaces WHERE owner_user_id = ? ORDER BY created_at LIMIT 1')
      .get(req.userId!) as { id: string } | undefined;
    if (!ws) throw AppError.notFound('Workspace');
    workspace.revokeInvite(ws.id, req.params.id!, req.userId!);
    send(res, { ok: true });
  })
);

wave3Router.patch(
  '/workspace/members/:userId/role',
  asyncHandler(async (req, res) => {
    const input = parseBody(updateMemberSchema, req.body);
    const ws = getDb()
      .prepare('SELECT id FROM workspaces WHERE owner_user_id = ? ORDER BY created_at LIMIT 1')
      .get(req.userId!) as { id: string } | undefined;
    if (!ws) throw AppError.notFound('Workspace');
    workspace.updateMemberRole(ws.id, req.params.userId!, input.role, req.userId!);
    send(res, { ok: true });
  })
);

wave3Router.delete(
  '/workspace/members/:userId',
  asyncHandler(async (req, res) => {
    const ws = getDb()
      .prepare('SELECT id FROM workspaces WHERE owner_user_id = ? ORDER BY created_at LIMIT 1')
      .get(req.userId!) as { id: string } | undefined;
    if (!ws) throw AppError.notFound('Workspace');
    workspace.removeMember(ws.id, req.params.userId!, req.userId!);
    send(res, { ok: true });
  })
);

// ---------- labels ----------
wave3Router.get(
  '/projects/:projectId/labels',
  asyncHandler(async (req, res) => {
    send(res, labels.listLabels(req.params.projectId!, req.userId!));
  })
);

wave3Router.post(
  '/projects/:projectId/labels',
  asyncHandler(async (req, res) => {
    const input = parseBody(createLabelSchema, req.body);
    send(res, labels.createLabel(req.params.projectId!, req.userId!, input.name, input.color));
  })
);

wave3Router.patch(
  '/projects/:projectId/labels/:id',
  asyncHandler(async (req, res) => {
    const input = parseBody(createLabelSchema.partial(), req.body);
    send(res, labels.updateLabel(req.params.projectId!, req.params.id!, req.userId!, input));
  })
);

wave3Router.delete(
  '/projects/:projectId/labels/:id',
  asyncHandler(async (req, res) => {
    labels.deleteLabel(req.params.projectId!, req.params.id!, req.userId!);
    send(res, { ok: true });
  })
);

wave3Router.put(
  '/projects/:projectId/stories/:id/labels',
  asyncHandler(async (req, res) => {
    const input = parseBody(setLabelsSchema, req.body);
    labels.setStoryLabels(req.params.projectId!, req.params.id!, input.labelIds);
    send(res, { ok: true });
  })
);

wave3Router.put(
  '/projects/:projectId/tasks/:id/labels',
  asyncHandler(async (req, res) => {
    const input = parseBody(setLabelsSchema, req.body);
    labels.setTaskLabels(req.params.projectId!, req.params.id!, input.labelIds);
    send(res, { ok: true });
  })
);

// ---------- roadmap ----------
wave3Router.get(
  '/projects/:projectId/roadmap',
  asyncHandler(async (req, res) => {
    send(res, getRoadmap(req.params.projectId!, req.userId!));
  })
);

// ---------- project import ----------
wave3Router.post(
  '/projects/import',
  asyncHandler(async (req, res) => {
    const input = parseBody(z.object({ name: z.string().trim().min(2).max(120).optional(), data: z.unknown() }), req.body);
    const ws = getDb()
      .prepare('SELECT id FROM workspaces WHERE owner_user_id = ? ORDER BY created_at LIMIT 1')
      .get(req.userId!) as { id: string } | undefined;
    if (!ws) throw AppError.notFound('Workspace');
    send(res, importProject(req.userId!, ws.id, input));
  })
);

// ---------- outgoing webhooks ----------
wave3Router.get(
  '/webhooks/outgoing',
  asyncHandler(async (req, res) => {
    send(res, outgoing.listWebhooks(req.userId!));
  })
);

wave3Router.post(
  '/webhooks/outgoing',
  asyncHandler(async (req, res) => {
    const input = parseBody(createOutgoingWebhookSchema, req.body);
    send(res, outgoing.createWebhook(req.userId!, input));
  })
);

wave3Router.patch(
  '/webhooks/outgoing/:id',
  asyncHandler(async (req, res) => {
    const input = parseBody(updateOutgoingWebhookSchema, req.body);
    send(res, outgoing.updateWebhook(req.userId!, req.params.id!, input));
  })
);

wave3Router.delete(
  '/webhooks/outgoing/:id',
  asyncHandler(async (req, res) => {
    outgoing.deleteWebhook(req.userId!, req.params.id!);
    send(res, { ok: true });
  })
);

wave3Router.post(
  '/webhooks/outgoing/:id/test',
  asyncHandler(async (req, res) => {
    send(res, await outgoing.testWebhook(req.userId!, req.params.id!));
  })
);
