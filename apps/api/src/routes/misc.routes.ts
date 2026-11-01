import { Router } from 'express';
import { asyncHandler, parseBody, send } from '../util/http.js';
import { requireAuth } from '../middleware/auth.js';
import { getDashboardStats } from '../services/analytics.service.js';
import { listGlobalActivity } from '../services/projects.service.js';
import { searchAll } from '../services/search.service.js';
import { parsePositiveInt } from '../util/http.js';
import { getDb } from '../db/database.js';
import * as events from '../services/events.service.js';
import { verifySignature, processWebhook } from '../services/github/webhooks.service.js';
import { AppError } from '../util/appError.js';
import { ErrorCodes } from '@devflow/shared';

export const miscRouter = Router();

// ---------- dashboard & activity (auth) ----------

const authed = Router();
authed.use(requireAuth);

authed.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    send(res, getDashboardStats(req.userId!));
  })
);

authed.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const limit = parsePositiveInt(req.query.limit, 8, 20, 1);
    send(res, searchAll(req.userId!, q, limit));
  })
);

authed.get(
  '/activity',
  asyncHandler(async (req, res) => {
    const limit = parsePositiveInt(req.query.limit, 20, 100);
    send(res, listGlobalActivity(req.userId!, limit));
  })
);

// ---------- notifications ----------

authed.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    send(res, events.listNotifications(req.userId!, 100));
  })
);

authed.post(
  '/notifications/:id/read',
  asyncHandler(async (req, res) => {
    events.markNotificationRead(req.userId!, req.params.id!);
    send(res, { ok: true });
  })
);

authed.post(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    events.markAllNotificationsRead(req.userId!);
    send(res, { ok: true });
  })
);

export { authed as authedMiscRouter };

// ---------- GitHub webhooks (public, HMAC-validated) ----------

export const webhooksRouter = Router();

webhooksRouter.post(
  '/github',
  asyncHandler(async (req, res) => {
    // raw body is required for signature verification — provided via express.text upstream
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    const event = req.headers['x-github-event'] as string | undefined;
    const delivery = req.headers['x-github-delivery'] as string | undefined;
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    if (!event || !delivery) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, 'Missing X-GitHub-Event or X-GitHub-Delivery headers');
    }
    if (!verifySignature(raw, signature)) {
      throw new AppError(401, ErrorCodes.FORBIDDEN, 'Invalid webhook signature');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, 'Webhook payload is not valid JSON');
    }
    send(res, processWebhook(event, delivery, payload));
  })
);
