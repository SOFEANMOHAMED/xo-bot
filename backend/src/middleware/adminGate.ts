import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { createError } from './errorHandler.js';

/**
 * Extra gate for admin APIs: requires `X-Admin-Gate` matching ADMIN_GATE_SECRET.
 * Returns 404 (not 403) so scanners do not learn that an admin surface exists.
 * Public admin endpoints (e.g. subscription plans) must be registered before this middleware.
 */
export const requireAdminGate = (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  const secret = (process.env.ADMIN_GATE_SECRET || '').trim();

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return next(createError('Not found', 404));
    }
    // Dev convenience when secret is not set yet
    return next();
  }

  const provided = String(req.headers['x-admin-gate'] || '').trim();
  if (!provided || provided !== secret) {
    return next(createError('Not found', 404));
  }

  next();
};
