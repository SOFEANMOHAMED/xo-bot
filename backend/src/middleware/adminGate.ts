import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { createError } from './errorHandler.js';
import {
  parseCookies,
  ADMIN_GATE_COOKIE,
  secretsEqual,
  verifyAdminGateProof,
  setAdminGateCookie,
  clearAdminGateCookie,
  createAdminGateProof
} from '../utils/authCookies.js';

/**
 * Extra gate for admin APIs.
 * Accepts HttpOnly unlock cookie (preferred) or legacy X-Admin-Gate header.
 * Returns 404 so scanners do not learn that an admin surface exists.
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
    return next();
  }

  const cookies = parseCookies(req);
  const cookieProof = (cookies[ADMIN_GATE_COOKIE] || '').trim();
  if (cookieProof && verifyAdminGateProof(cookieProof)) {
    return next();
  }

  // Legacy header support (clients must not bake the secret into JS bundles)
  const provided = String(req.headers['x-admin-gate'] || '').trim();
  if (provided && secretsEqual(provided, secret)) {
    return next();
  }

  return next(createError('Not found', 404));
};

/** POST body `{ secret }` → sets HttpOnly admin-gate cookie (no secret stored in browser JS). */
export const unlockAdminGate = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const expected = (process.env.ADMIN_GATE_SECRET || '').trim();
    if (!expected) {
      if (process.env.NODE_ENV === 'production') {
        return next(createError('Not found', 404));
      }
      setAdminGateCookie(res);
      return res.json({ success: true, data: { unlocked: true } });
    }

    const provided = String((req.body as any)?.secret || '').trim();
    if (!provided || !secretsEqual(provided, expected) || !createAdminGateProof()) {
      return next(createError('Not found', 404));
    }

    setAdminGateCookie(res);
    return res.json({ success: true, data: { unlocked: true } });
  } catch (error) {
    next(error);
  }
};

export const lockAdminGate = (_req: AuthRequest, res: Response) => {
  clearAdminGateCookie(res);
  res.json({ success: true, data: { unlocked: false } });
};

export const adminGateStatus = (req: AuthRequest, res: Response) => {
  const cookies = parseCookies(req);
  const unlocked = verifyAdminGateProof((cookies[ADMIN_GATE_COOKIE] || '').trim());
  res.json({ success: true, data: { unlocked } });
};
