import jwt, { SignOptions } from 'jsonwebtoken';
import { createError } from '../middleware/errorHandler.js';

export interface JwtAuthPayload {
  userId: string;
  merchantId: string;
  role: string;
  impersonatedBy?: string;
  impersonatedByRole?: string;
}

function getJwtSecret(): string {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw createError('JWT secret not configured', 500);
  }
  return jwtSecret;
}

export function generateAuthToken(
  userId: string,
  merchantId: string,
  role: string,
  extra?: Pick<JwtAuthPayload, 'impersonatedBy' | 'impersonatedByRole'>,
  expiresIn?: string
): string {
  const payload: JwtAuthPayload = {
    userId,
    merchantId,
    role,
    ...extra,
  };

  const options: SignOptions = {
    expiresIn: (expiresIn || process.env.JWT_EXPIRES_IN || '7d') as SignOptions['expiresIn'],
  };

  return jwt.sign(payload, getJwtSecret(), options);
}

/** Short-lived token for super-admin support access to a merchant account. */
export function generateImpersonationToken(
  targetUserId: string,
  adminId: string,
  adminRole: string
): string {
  return generateAuthToken(
    targetUserId,
    targetUserId,
    'user',
    { impersonatedBy: adminId, impersonatedByRole: adminRole },
    process.env.IMPERSONATION_JWT_EXPIRES_IN || '2h'
  );
}

export function verifyAuthToken(token: string): JwtAuthPayload {
  return jwt.verify(token, getJwtSecret()) as JwtAuthPayload;
}
