import express from 'express';
import { cors, securityHeaders } from './middleware/security.js';
import { requestContext } from './middleware/requestContext.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { authRouter } from './routes/auth.routes.js';
import { projectsRouter } from './routes/projects.routes.js';
import { backlogRouter } from './routes/backlog.routes.js';
import { sprintsRouter } from './routes/sprints.routes.js';
import { aiRouter } from './routes/ai.routes.js';
import { githubRouter } from './routes/github.routes.js';
import { executionsRouter } from './routes/executions.routes.js';
import { authedMiscRouter, webhooksRouter } from './routes/misc.routes.js';
import { logger } from './util/logger.js';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use(cors);

  // webhook route must receive the RAW body for HMAC verification
  app.use('/api/webhooks', express.text({ type: '*/*', limit: '1mb' }), webhooksRouter);

  app.use(express.json({ limit: '2mb' }));
  app.use(requestContext);

  app.get('/api/health', (_req, res) => {
    res.json({ data: { ok: true, service: 'devflow-ai-api', time: new Date().toISOString() } });
  });

  app.use('/api', authRouter);
  app.use('/api', authedMiscRouter);
  app.use('/api', projectsRouter);
  app.use('/api', backlogRouter);
  app.use('/api', sprintsRouter);
  app.use('/api', aiRouter);
  app.use('/api', githubRouter);
  app.use('/api', executionsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  logger.debug('express app assembled');
  return app;
}
