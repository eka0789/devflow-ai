import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes } from '@devflow/shared';
import { AppError } from '../util/appError.js';
import { logger } from '../util/logger.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: ErrorCodes.NOT_FOUND, message: `No route for ${req.method} ${req.path}` },
    requestId: req.requestId,
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
      requestId: req.requestId,
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: ErrorCodes.VALIDATION_FAILED,
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      requestId: req.requestId,
    });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({
      error: { code: ErrorCodes.VALIDATION_FAILED, message: 'Malformed JSON body' },
      requestId: req.requestId,
    });
    return;
  }
  logger.error('unhandled error', {
    reqId: req.requestId,
    path: req.originalUrl,
    err: err instanceof Error ? err.stack : String(err),
  });
  res.status(500).json({
    error: { code: ErrorCodes.INTERNAL, message: 'Internal server error' },
    requestId: req.requestId,
  });
}
