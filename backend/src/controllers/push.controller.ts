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

/**
 * Public VAPID key for browser PushManager.subscribe
 */
export const getPushVapidPublicKey = async (
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

    res.json({
      success: true,
      data: { publicKey },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Whether the current merchant has at least one push subscription
 */
export const getPushStatus = async (
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

/**
 * Save / refresh a device push subscription (merchant-scoped)
 */
export const subscribePush = async (
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

/**
 * Remove a device push subscription for this merchant only
 */
export const unsubscribePush = async (
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

/**
 * Send a test push to the current merchant's devices
 */
export const sendTestPush = async (
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
      title: 'Xo Bot — إشعار تجريبي',
      body: 'تم تفعيل إشعارات الجوال بنجاح. ستصلك تنبيهات الطلبات والتصعيد هنا.',
      url: '/app/notifications',
      tag: 'xobot-test',
      type: 'success',
      data: { kind: 'test' },
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

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
