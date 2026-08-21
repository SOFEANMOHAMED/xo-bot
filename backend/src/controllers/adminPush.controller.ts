/**
 * Web Push subscribe/status for Super Admin devices (owner/admin accounts).
 * Reuses push_subscriptions keyed by the admin's merchant_id — SaaS-safe.
 */

import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import {
  getVapidPublicKey,
  savePushSubscription,
  removePushSubscription,
  hasPushSubscription,
  sendPushToMerchant,
  type PushSubscriptionInput,
} from '../services/webPush.js';

export const getAdminPushVapidPublicKey = async (
  _req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const publicKey = getVapidPublicKey();
    if (!publicKey) {
      return res.status(503).json({
        success: false,
        error: { message: 'Web Push is not configured' },
      });
    }
    res.json({ success: true, data: { publicKey } });
  } catch (error) {
    next(error);
  }
};

export const getAdminPushStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return res.status(401).json({
        success: false,
        error: { message: 'Unauthorized' },
      });
    }

    const subscribed = await hasPushSubscription(merchantId);
    const configured = !!getVapidPublicKey();

    res.json({
      success: true,
      data: { subscribed, configured },
    });
  } catch (error) {
    next(error);
  }
};

export const subscribeAdminPush = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return res.status(401).json({
        success: false,
        error: { message: 'Unauthorized' },
      });
    }

    const subscription = req.body?.subscription as PushSubscriptionInput | undefined;
    if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid subscription payload' },
      });
    }

    const userAgent =
      (typeof req.body?.userAgent === 'string' && req.body.userAgent) ||
      req.get('user-agent') ||
      null;

    await savePushSubscription({ merchantId, subscription, userAgent });

    res.json({
      success: true,
      data: { subscribed: true },
    });
  } catch (error) {
    next(error);
  }
};

export const unsubscribeAdminPush = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return res.status(401).json({
        success: false,
        error: { message: 'Unauthorized' },
      });
    }

    const endpoint = String(req.body?.endpoint || '').trim();
    if (!endpoint) {
      return res.status(400).json({
        success: false,
        error: { message: 'endpoint is required' },
      });
    }

    const removed = await removePushSubscription({ merchantId, endpoint });

    res.json({
      success: true,
      data: { removed },
    });
  } catch (error) {
    next(error);
  }
};

export const sendAdminTestPush = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return res.status(401).json({
        success: false,
        error: { message: 'Unauthorized' },
      });
    }

    const result = await sendPushToMerchant(merchantId, {
      title: 'XO Bot — إشعار أدمن تجريبي',
      body: 'تم تفعيل إشعارات الجوال للسوبر أدمن. ستصلك رسائل صفحة XO Bot هنا.',
      type: 'official_inbox',
      tag: 'admin-push-test',
      data: { kind: 'official_inbox' },
    });

    if (result.sent === 0) {
      return res.status(400).json({
        success: false,
        error: {
          message:
            result.failed > 0
              ? 'فشل إرسال الإشعار. أعد تفعيل الإشعارات من هذا الجهاز.'
              : 'لا يوجد جهاز مشترك. فعّل الإشعارات أولاً.',
        },
      });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};
