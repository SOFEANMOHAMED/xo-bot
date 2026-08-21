/**
 * Web Push for merchant PWA notifications (SaaS-safe: merchant_id scoped).
 */

import webpush from 'web-push';
import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';

export type PushSubscriptionInput = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  expirationTime?: number | null;
};

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  type?: string;
  notificationId?: string | null;
  data?: Record<string, unknown>;
};

let configured = false;
let tableReady = false;

function ensureVapidConfigured(): boolean {
  if (configured) return true;

  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:support@xo-bot.com';

  if (!publicKey || !privateKey) {
    logger.warn('Web Push disabled: VAPID keys not configured');
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export function getVapidPublicKey(): string | null {
  const key = process.env.VAPID_PUBLIC_KEY?.trim();
  return key || null;
}

export async function ensurePushSubscriptionsTable(): Promise<void> {
  if (tableReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (merchant_id, endpoint)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_merchant_id
    ON push_subscriptions(merchant_id)
  `);

  tableReady = true;
}

export async function savePushSubscription(params: {
  merchantId: string;
  subscription: PushSubscriptionInput;
  userAgent?: string | null;
}): Promise<void> {
  const { merchantId, subscription, userAgent } = params;
  if (!merchantId || !subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    throw new Error('Invalid push subscription');
  }

  await ensurePushSubscriptionsTable();

  await pool.query(
    `INSERT INTO push_subscriptions (merchant_id, endpoint, p256dh, auth, user_agent, updated_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (merchant_id, endpoint)
     DO UPDATE SET
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       user_agent = COALESCE(EXCLUDED.user_agent, push_subscriptions.user_agent),
       updated_at = CURRENT_TIMESTAMP`,
    [
      merchantId,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      userAgent || null,
    ]
  );
}

export async function removePushSubscription(params: {
  merchantId: string;
  endpoint: string;
}): Promise<boolean> {
  const { merchantId, endpoint } = params;
  if (!merchantId || !endpoint) return false;

  await ensurePushSubscriptionsTable();

  const result = await pool.query(
    `DELETE FROM push_subscriptions
     WHERE merchant_id = $1 AND endpoint = $2
     RETURNING id`,
    [merchantId, endpoint]
  );

  return result.rows.length > 0;
}

export async function hasPushSubscription(merchantId: string): Promise<boolean> {
  if (!merchantId) return false;
  await ensurePushSubscriptionsTable();

  const result = await pool.query(
    `SELECT 1 FROM push_subscriptions WHERE merchant_id = $1 LIMIT 1`,
    [merchantId]
  );
  return result.rows.length > 0;
}

function resolveNotificationUrl(payload: PushPayload): string {
  const base = (process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'https://xo-bot.com')
    .split(',')[0]
    .trim()
    .replace(/\/$/, '');

  if (payload.url) {
    if (payload.url.startsWith('http')) return payload.url;
    return `${base}${payload.url.startsWith('/') ? '' : '/'}${payload.url}`;
  }

  const kind = payload.data?.kind || payload.type;
  if (kind === 'new_order' || payload.data?.orderId) {
    return `${base}/app/orders`;
  }
  if (kind === 'escalation') {
    return `${base}/app/notifications`;
  }
  if (kind === 'official_inbox' || kind === 'subscription_payment' || kind === 'withdrawal_request') {
    return resolveAdminDeepLink(kind);
  }
  return `${base}/app/notifications`;
}

function getAdminBasePath(): string {
  const fallback =
    process.env.ADMIN_FRONTEND_BASE_PATH ||
    process.env.VITE_ADMIN_BASE_PATH ||
    '/ops-change-me-to-a-random-path';
  let p = String(fallback).trim();
  if (!p.startsWith('/')) p = `/${p}`;
  return p.replace(/\/+$/, '') || '/ops-change-me-to-a-random-path';
}

function resolveAdminDeepLink(kind: string): string {
  const base = (process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'https://xo-bot.com')
    .split(',')[0]
    .trim()
    .replace(/\/$/, '');
  const adminBase = getAdminBasePath();
  if (kind === 'official_inbox') {
    return `${base}${adminBase}/xo-page-inbox`;
  }
  if (kind === 'subscription_payment') {
    return `${base}${adminBase}/payment-requests`;
  }
  if (kind === 'withdrawal_request') {
    return `${base}${adminBase}/affiliate`;
  }
  return `${base}${adminBase}/notifications`;
}

/**
 * Send a Web Push to all devices registered for this merchant only.
 * Fire-and-forget safe: never throws to callers.
 */
export async function sendPushToMerchant(
  merchantId: string,
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  if (!merchantId || !payload.title?.trim()) {
    return { sent: 0, failed: 0 };
  }
  if (!ensureVapidConfigured()) {
    return { sent: 0, failed: 0 };
  }

  try {
    await ensurePushSubscriptionsTable();

    const result = await pool.query(
      `SELECT id, endpoint, p256dh, auth, merchant_id
       FROM push_subscriptions
       WHERE merchant_id = $1`,
      [merchantId]
    );

    return await deliverPushRows(result.rows, payload);
  } catch (error) {
    logger.error('sendPushToMerchant failed', error as Error, { merchantId });
    return { sent: 0, failed: 0 };
  }
}

type PushRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  merchant_id: string;
};

async function deliverPushRows(
  rows: PushRow[],
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  if (rows.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const body = JSON.stringify({
    title: payload.title.trim().slice(0, 120),
    body: (payload.body || '').trim().slice(0, 240),
    url: resolveNotificationUrl(payload),
    tag: payload.tag || payload.notificationId || `xobot-${Date.now()}`,
    type: payload.type || 'info',
    notificationId: payload.notificationId || null,
    data: payload.data || {},
  });

  let sent = 0;
  let failed = 0;

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          body,
          { TTL: 60 * 60 * 12, urgency: 'high' }
        );
        sent++;
      } catch (err: any) {
        failed++;
        const statusCode = err?.statusCode || err?.status;
        // Gone / expired subscription — remove only for this merchant
        if (statusCode === 404 || statusCode === 410) {
          await pool.query(
            `DELETE FROM push_subscriptions WHERE id = $1 AND merchant_id = $2`,
            [row.id, row.merchant_id]
          );
        } else {
          logger.warn('Web Push send failed', {
            merchantId: row.merchant_id,
            statusCode,
            message: err?.message,
          });
        }
      }
    })
  );

  return { sent, failed };
}

/**
 * Fan-out Web Push to every device belonging to owner/admin accounts.
 * Used for platform alerts (official inbox, payments, withdrawals).
 */
export async function sendPushToAdmins(
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  if (!payload.title?.trim()) {
    return { sent: 0, failed: 0 };
  }
  if (!ensureVapidConfigured()) {
    return { sent: 0, failed: 0 };
  }

  try {
    await ensurePushSubscriptionsTable();

    const result = await pool.query(
      `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth, ps.merchant_id
       FROM push_subscriptions ps
       INNER JOIN merchants m ON m.id = ps.merchant_id
       WHERE m.role IN ('owner', 'admin')`
    );

    const delivery = await deliverPushRows(result.rows, payload);
    if (delivery.sent === 0 && result.rows.length === 0) {
      logger.info('Admin Web Push skipped — no admin device subscriptions');
    }
    return delivery;
  } catch (error) {
    logger.error('sendPushToAdmins failed', error as Error);
    return { sent: 0, failed: 0 };
  }
}

/** Non-blocking wrapper */
export function sendPushToMerchantAsync(merchantId: string, payload: PushPayload): void {
  void sendPushToMerchant(merchantId, payload).catch((err) => {
    logger.error('sendPushToMerchantAsync failed', err as Error, { merchantId });
  });
}

export function sendPushToAdminsAsync(payload: PushPayload): void {
  void sendPushToAdmins(payload).catch((err) => {
    logger.error('sendPushToAdminsAsync failed', err as Error);
  });
}
