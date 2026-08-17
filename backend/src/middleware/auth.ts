import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createError } from './errorHandler.js';
import { parseCookies, AUTH_COOKIE } from '../utils/authCookies.js';

export interface AuthRequest extends Request {
  userId?: string;
  merchantId?: string;
  userRole?: string;
}

function extractToken(req: AuthRequest): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.substring(7).trim();
    if (bearer) return bearer;
  }
  const cookies = parseCookies(req);
  const cookieToken = (cookies[AUTH_COOKIE] || '').trim();
  return cookieToken || null;
}

export const authenticate = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = extractToken(req);
    if (!token) {
      throw createError('Authentication required', 401);
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw createError('JWT secret not configured', 500);
    }

    const decoded = jwt.verify(token, jwtSecret) as {
      userId: string;
      merchantId: string;
      role: string;
    };

    req.userId = decoded.userId;
    req.merchantId = decoded.merchantId;
    req.userRole = decoded.role;

    next();
  } catch (error: any) {
    if (error.name === 'JsonWebTokenError') {
      return next(createError('Invalid token', 401));
    }
    if (error.name === 'TokenExpiredError') {
      return next(createError('Token expired', 401));
    }
    next(error);
  }
};

export const requireRole = (...allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userRole) {
      return next(createError('Authentication required', 401));
    }

    if (!allowedRoles.includes(req.userRole)) {
      return next(createError('Insufficient permissions', 403));
    }

    next();
  };
};
