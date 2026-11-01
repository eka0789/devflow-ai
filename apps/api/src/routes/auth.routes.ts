import { Router } from 'express';
import { z } from 'zod';
import { loginSchema, registerSchema } from '@devflow/shared';
import { asyncHandler, parseBody, send } from '../util/http.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/auth.js';
import * as auth from '../services/auth.service.js';

export const authRouter = Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

authRouter.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = parseBody(registerSchema, req.body);
    send(res, auth.register(input.name, input.email, input.password));
  })
);

authRouter.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = parseBody(loginSchema, req.body);
    send(res, auth.login(input.email, input.password));
  })
);

authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (_req, res) => {
    // stateless JWT — client discards the token
    send(res, { ok: true });
  })
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    send(res, auth.getUser(req.userId!));
  })
);

authRouter.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const schema = z.object({ name: z.string().trim().min(2).max(80) });
    const input = parseBody(schema, req.body);
    send(res, auth.updateName(req.userId!, input.name));
  })
);
