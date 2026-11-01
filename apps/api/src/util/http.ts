import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, type ZodTypeAny } from 'zod';

/** Express 4-safe async wrapper. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** Validates and returns the *output* type (defaults applied). */
export function parseBody<S extends ZodTypeAny>(schema: S, body: unknown): z.output<S> {
  return schema.parse(body) as z.output<S>;
}

export function parseParams<S extends ZodTypeAny>(schema: S, source: unknown): z.output<S> {
  return schema.parse(source) as z.output<S>;
}

export function send<T>(res: Response, data: T): void {
  res.json({ data });
}
