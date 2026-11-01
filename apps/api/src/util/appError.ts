/** Structured application error carried through the whole request pipeline. */
import { ErrorCodes, type ErrorCode } from '@devflow/shared';

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static notFound(what = 'Resource'): AppError {
    return new AppError(404, ErrorCodes.NOT_FOUND, `${what} not found`);
  }

  static forbidden(message = 'You do not have access to this resource'): AppError {
    return new AppError(403, ErrorCodes.FORBIDDEN, message);
  }

  static unauthenticated(message = 'Authentication required'): AppError {
    return new AppError(401, ErrorCodes.UNAUTHENTICATED, message);
  }

  static conflict(code: ErrorCode, message: string, details?: unknown): AppError {
    return new AppError(409, code, message, details);
  }

  static badRequest(code: ErrorCode, message: string, details?: unknown): AppError {
    return new AppError(400, code, message, details);
  }
}
