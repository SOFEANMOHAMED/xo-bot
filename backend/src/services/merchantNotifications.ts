/**
 * Merchant-scoped notifications (SaaS-safe).
 * Also fans out to Web Push for that merchant only.
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';
import { sendPushToMerchantAsync } from './webPush.js';

export type MerchantNotificationType = 'info' | 'success' | 'warning' | 'error' | 'escalation';

export async function createMerchantNotification(params: {
  merchantId: string;
  type?: MerchantNotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown> | null;
  /** Skip Web Push (e.g. when caller already sent one) */
  skipPush?: boolean;
}): Promise<string | null> {
  const { merchantId, title, message } = params;
  if (!merchantId || !title?.trim() || !message?.trim()) {
    return null;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_notifications (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL DEFAULT 'info',
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        data JSONB,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        read_at TIMESTAMP
      )
    `);

    const notifType = params.type || 'info';
    const notifTitle = title.trim().slice(0, 255);
    const notifMessage = message.trim();
    const notifData = params.data || {};

    const result = await pool.query(
      `INSERT INTO user_notifications (merchant_id, type, title, message, data, is_read)
       VALUES ($1, $2, $3, $4, $5::jsonb, FALSE)
       RETURNING id`,
      [
        merchantId,
        notifType,
        notifTitle,
        notifMessage,
        JSON.stringify(notifData),
      ]
    );

    const notificationId = result.rows[0]?.id || null;

    if (notificationId && !params.skipPush) {
      const pushBody = notifMessage.replace(/\s+/g, ' ').trim().slice(0, 180);
      sendPushToMerchantAsync(merchantId, {
        title: notifTitle,
        body: pushBody,
        type: notifType,
        notificationId: String(notificationId),
        tag: String(notificationId),
        data: notifData,
      });
    }

    return notificationId;
  } catch (error) {
    logger.error('Failed to create merchant notification', error as Error, {
      merchantId,
      title,
    });
    return null;
  }
}
