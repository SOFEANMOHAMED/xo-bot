import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { createError } from './errorHandler.js';
import pool from '../database/connection.js';
import { enforceMerchantSubscriptionExpiry, ensureSubscriptionEndsAtColumn } from '../services/subscriptionExpiry/index.js';

/** Paths still reachable after trial/paid subscription expiry (renewal + profile). */
const ALLOWED_WHEN_EXPIRED = [
  '/api/auth/profile',
  '/api/auth/logout',
  '/api/admin/subscriptions/public',
  '/api/subscriptions',
  '/api/billing',
  '/api/upload/proof'
];

function isAllowedExpiredPath(requestPath: string): boolean {
  return ALLOWED_WHEN_EXPIRED.some((path) => requestPath.includes(path));
}

/**
 * Middleware to check if user's trial / paid subscription has expired.
 * Blocks access if expired (except profile + billing renewal paths).
 */
export const checkSubscriptionStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    // Allow owners and admins to bypass subscription checks
    if (req.userRole === 'owner' || req.userRole === 'admin') {
      return next();
    }

    await ensureSubscriptionEndsAtColumn();

    const result = await pool.query(
      `SELECT subscription_plan, subscription_status, trial_ends_at, subscription_ends_at
       FROM merchants
       WHERE id = $1`,
      [merchantId]
    );

    if (result.rows.length === 0) {
      return next(createError('User not found', 404));
    }

    const merchant = result.rows[0];
    const subscriptionPlan = merchant.subscription_plan || 'trial';
    let subscriptionStatus = merchant.subscription_status || 'active';
    const trialEndsAt = merchant.trial_ends_at;

    // Auto-expire paid plans whose period has ended
    const enforced = await enforceMerchantSubscriptionExpiry(merchantId, {
      subscription_plan: merchant.subscription_plan,
      subscription_status: merchant.subscription_status,
      subscription_ends_at: merchant.subscription_ends_at
    });
    subscriptionStatus = enforced.subscriptionStatus;

    if (subscriptionStatus === 'suspended' || subscriptionStatus === 'expired') {
      if (isAllowedExpiredPath(req.path) || isAllowedExpiredPath(req.originalUrl || '')) {
        return next();
      }
      return next(
        createError(
          'انتهى اشتراكك أو تم تعليق حسابك. يرجى تجديد الباقة للاستمرار في استخدام الخدمة.',
          403,
          true,
          'SUBSCRIPTION_EXPIRED'
        )
      );
    }

    // Trial plan: block after trial_ends_at (except renewal paths)
    if (subscriptionPlan === 'trial' && trialEndsAt) {
      const now = new Date();
      const trialEndDate = new Date(trialEndsAt);

      if (now > trialEndDate) {
        if (!isAllowedExpiredPath(req.path) && !isAllowedExpiredPath(req.originalUrl || '')) {
          return next(
            createError(
              'انتهت الفترة التجريبية المجانية. يرجى ترقية باقاتك للاستمرار في استخدام الخدمة.',
              403,
              true,
              'TRIAL_EXPIRED'
            )
          );
        }
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};
