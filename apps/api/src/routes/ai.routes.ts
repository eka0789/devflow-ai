import { Router } from 'express';
import { z } from 'zod';
import {
  aiSettingsSchema,
  approveBacklogDraftSchema,
  createConversationSchema,
  runWorkflowSchema,
  sendMessageSchema,
} from '@devflow/shared';
import { asyncHandler, parseBody, parsePositiveInt, send } from '../util/http.js';
import { AppError } from '../util/appError.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import * as settings from '../services/settings.service.js';
import * as chat from '../services/ai/chat.service.js';
import * as agents from '../services/ai/agents.service.js';
import * as drafts from '../services/drafts.service.js';
import { getAIUsage } from '../services/analytics.service.js';

export const aiRouter = Router();
aiRouter.use(requireAuth);

const projectIdParam = z.object({ projectId: z.string().uuid() });
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyOf: (req) => req.userId ?? req.ip ?? 'anon',
});

// ---------- provider settings ----------

aiRouter.get(
  '/ai/settings',
  asyncHandler(async (req, res) => {
    send(res, settings.getAISettingsPublic(req.userId!));
  })
);

aiRouter.put(
  '/ai/settings',
  asyncHandler(async (req, res) => {
    const input = parseBody(aiSettingsSchema, req.body);
    send(res, settings.setAISettings(req.userId!, input));
  })
);

aiRouter.post(
  '/ai/verify',
  asyncHandler(async (req, res) => {
    send(res, await chat.verifyProvider(req.userId!));
  })
);

aiRouter.get(
  '/ai/usage',
  asyncHandler(async (req, res) => {
    const days = parsePositiveInt(req.query.days, 30, 120, 1);
    send(res, getAIUsage(req.userId!, days));
  })
);

// ---------- conversations & streaming chat ----------

aiRouter.get(
  '/conversations',
  asyncHandler(async (req, res) => {
    const projectId = typeof req.query.projectId === 'string' && req.query.projectId.length > 0 ? req.query.projectId : null;
    send(res, chat.listConversations(req.userId!, projectId));
  })
);

aiRouter.post(
  '/conversations',
  asyncHandler(async (req, res) => {
    const input = parseBody(createConversationSchema, req.body);
    send(res, chat.createConversation(req.userId!, input.projectId ?? null, input.title ?? null));
  })
);

aiRouter.get(
  '/conversations/:id',
  asyncHandler(async (req, res) => {
    send(res, chat.getConversation(req.userId!, req.params.id!));
  })
);

aiRouter.delete(
  '/conversations/:id',
  asyncHandler(async (req, res) => {
    chat.deleteConversation(req.userId!, req.params.id!);
    send(res, { ok: true });
  })
);

// Streaming chat over SSE (POST + fetch reader on the client)
aiRouter.post(
  '/conversations/:id/chat',
  chatLimiter,
  asyncHandler(async (req, res) => {
    const input = parseBody(sendMessageSchema, req.body);
    const conversationId = req.params.id!;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const sse = (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    // start with an empty comment so the client's reader opens immediately
    res.write(': stream open\n\n');

    // stop consuming the upstream provider when the client goes away
    const upstream = new AbortController();
    res.on('close', () => upstream.abort());

    try {
      await chat.streamChat(req.userId!, conversationId, input.content, {
        signal: upstream.signal,
        onDelta: (text) => sse('delta', { text }),
        onDone: (payload) => {
          sse('done', payload);
          res.end();
        },
        onError: (payload) => {
          sse('error', payload);
          res.end();
        },
      });
    } catch (err) {
      // conversation ownership errors etc. — surface through the stream
      const appErr = err instanceof AppError ? err : null;
      sse('error', {
        code: appErr?.code ?? 'INTERNAL',
        message: appErr?.message ?? (err instanceof Error ? err.message : 'stream failed'),
      });
      res.end();
    }
  })
);

// ---------- agents & workflows ----------

aiRouter.get(
  '/agents',
  asyncHandler(async (_req, res) => {
    send(res, { agents: agents.listAgents() });
  })
);

aiRouter.post(
  '/projects/:projectId/workflows',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    const input = parseBody(runWorkflowSchema, req.body);
    send(res, agents.startWorkflow(req.params.projectId!, req.userId!, input.workflow, input.vision));
  })
);

aiRouter.get(
  '/projects/:projectId/agent-runs/:runId',
  asyncHandler(async (req, res) => {
    send(res, agents.getAgentRun(req.params.projectId!, req.userId!, req.params.runId!));
  })
);

aiRouter.get(
  '/projects/:projectId/agent-runs',
  asyncHandler(async (req, res) => {
    const limit = parsePositiveInt(req.query.limit, 20, 50);
    send(res, agents.listAgentRuns(req.params.projectId!, req.userId!, limit));
  })
);

// ---------- drafts ----------

aiRouter.get(
  '/projects/:projectId/drafts/:id',
  asyncHandler(async (req, res) => {
    send(res, drafts.getDraft(req.params.projectId!, req.params.id!, req.userId!));
  })
);

aiRouter.get(
  '/projects/:projectId/drafts',
  asyncHandler(async (req, res) => {
    const type = typeof req.query.type === 'string' ? req.query.type : null;
    send(res, drafts.listDrafts(req.params.projectId!, req.userId!, type));
  })
);

aiRouter.post(
  '/projects/:projectId/drafts/:id/approve',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    const input = parseBody(approveBacklogDraftSchema, req.body ?? {});
    send(res, drafts.approveDraft(req.params.projectId!, req.params.id!, req.userId!, input.createRecords ?? true));
  })
);

aiRouter.post(
  '/projects/:projectId/drafts/:id/reject',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    send(res, drafts.rejectDraft(req.params.projectId!, req.params.id!, req.userId!));
  })
);
