import type { NextFunction, Request, Response } from 'express';
import { ErrorCodes } from '@devflow/shared';
import { AppError } from '../util/appError.js';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Simple fixed-window in-memory rate limiter (per API instance). */
export function rateLimit(options: {
  windowMs: number;
  max: number;
  keyOf?: (req: Request) => string;
}): (req: Request, _res: Response, next: NextFunction) => void {
  const { windowMs, max, keyOf } = options;
  return (req, _res, next) => {
    const key = keyOf ? keyOf(req) : (req.ip ?? 'unknown');
    const now = Date.now();
    // opportunistic cleanup — sampled so a large map never forces full scans
    if (Math.random() < 0.01 && buckets.size > 0) {
      for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
    }
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > max) {
      const retrySec = Math.ceil((bucket.resetAt - now) / 1000);
      next(
        new AppError(429, ErrorCodes.RATE_LIMITED, `Too many requests. Retry in ${retrySec}s`, {
          retryAfterSeconds: retrySec,
        })
      );
      return;
    }
    next();
  };
}

export function resetRateLimits(): void {
  buckets.clear();
}
