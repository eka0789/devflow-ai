import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../util/appError.js';
import { verifyJwt } from '../util/jwt.js';
import { config } from '../config.js';

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match?.[1];
  if (!token) {
    next(AppError.unauthenticated('Missing bearer token'));
    return;
  }
  const payload = verifyJwt(token, config.appSecret);
  if (!payload) {
    next(AppError.unauthenticated('Invalid or expired token'));
    return;
  }
  req.userId = payload.sub;
  req.userEmail = payload.email;
  next();
}
