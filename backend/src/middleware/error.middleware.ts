import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError.js';
import { logger } from '../utils/logger.js';
import { ZodError } from 'zod';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request payload',
        details: err.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
      },
    });
    return;
  }

  if (['P2025', 'P2034'].includes((err as any).code)) {
    res.status(409).json({ success: false, error: { code: 'STATE_CONFLICT', message: 'Ride or driver state changed. Refresh and retry.' } });
    return;
  }
  logger.error('Unhandled Server Error:', err.name);

  const isProd = process.env.NODE_ENV === 'production';
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: isProd ? 'An unexpected server error occurred' : err.message,
    },
  });
}
