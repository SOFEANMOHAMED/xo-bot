import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { createError } from './errorHandler.js';
import pool from '../database/connection.js';

/**
 * Middleware to check if user's trial period has expired
 * Blocks access if trial expired and user hasn't subscribed to a paid plan
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

    // Get merchant subscription details
    const result = await pool.query(
      `SELECT subscription_plan, subscription_status, trial_ends_at 
       FROM merchants 
       WHERE id = $1`,
      [merchantId]
    );

    if (result.rows.length === 0) {
      return next(createError('User not found', 404));
    }

    const merchant = result.rows[0];
    const subscriptionPlan = merchant.subscription_plan || 'trial';
    const subscriptionStatus = merchant.subscription_status || 'active';
    const trialEndsAt = merchant.trial_ends_at;

    // Check if subscription is suspended or expired
    if (subscriptionStatus === 'suspended' || subscriptionStatus === 'expired') {
      return next(createError(
        'تم تعليق حسابك. يرجى التواصل مع الدعم أو ترقية باقاتك للاستمرار.',
        403
      ));
    }

    // Check if user is on trial plan and trial has expired
    // During trial period (7 days), all features are unlimited
    // After trial expires, block access except for profile and subscription pages
    if (subscriptionPlan === 'trial' && trialEndsAt) {
      const now = new Date();
      const trialEndDate = new Date(trialEndsAt);

      if (now > trialEndDate) {
        // Trial has expired - block access except for profile and subscription pages
        const allowedPaths = [
          '/api/auth/profile',
          '/api/auth/logout',
          '/api/admin/subscriptions/public',
          '/api/subscriptions',
          '/api/billing',
          '/api/upload/proof'
        ];

        const requestPath = req.path;
        const isAllowedPath = allowedPaths.some(path => requestPath.includes(path));

        if (!isAllowedPath) {
          const error: any = createError(
            'انتهت الفترة التجريبية المجانية. يرجى ترقية باقاتك للاستمرار في استخدام الخدمة.',
            403
          );
          error.code = 'TRIAL_EXPIRED';
          error.requiresUpgrade = true;
          return next(error);
        }
      }
    }

    // If user has a paid plan (not trial), or trial is still active, allow access
    next();
  } catch (error) {
    next(error);
  }
};

