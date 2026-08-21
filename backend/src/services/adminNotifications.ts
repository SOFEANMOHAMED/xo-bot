/**
 * Platform-level admin notifications (not merchant-scoped).
 * Persists to admin_notifications and fans out Web Push to owner/admin devices.
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';
import { sendPushToAdminsAsync } from './webPush.js';

let tableEnsured = false;

export async function ensureAdminNotificationsTable(): Promise<void> {
  if (tableEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_notifications (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      type VARCHAR(50) NOT NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      data JSONB,
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      read_at TIMESTAMP
    )
  `);
  tableEnsured = true;
}

function fanOutAdminPush(params: {
  notificationId?: string | null;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}): void {
  const pushBody = params.message.replace(/\s+/g, ' ').trim().slice(0, 180);
  const data = {
    ...(params.data || {}),
    kind: params.type,
  };
  sendPushToAdminsAsync({
    title: params.title.trim().slice(0, 120),
    body: pushBody,
    type: params.type,
    notificationId: params.notificationId || null,
    tag:
      params.type === 'official_inbox' && params.data?.conversationId
        ? `official-inbox-${params.data.conversationId}`
        : params.notificationId || `admin-${params.type}-${Date.now()}`,
    data,
  });
}

export async function createAdminNotification(params: {
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  /** Skip Web Push (rare) */
  skipPush?: boolean;
}): Promise<string | null> {
  try {
    await ensureAdminNotificationsTable();
    const result = await pool.query(
      `INSERT INTO admin_notifications (type, title, message, data, is_read)
       VALUES ($1, $2, $3, $4::jsonb, FALSE)
       RETURNING id`,
      [
        params.type.slice(0, 50),
        params.title.slice(0, 255),
        params.message,
        JSON.stringify(params.data || {}),
      ]
    );
    const notificationId = result.rows[0]?.id ? String(result.rows[0].id) : null;

    if (notificationId && !params.skipPush) {
      fanOutAdminPush({
        notificationId,
        type: params.type,
        title: params.title,
        message: params.message,
        data: params.data,
      });
    }

    return notificationId;
  } catch (error) {
    logger.warn('Failed to create admin notification', {
      type: params.type,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Notify admins of a new inbound Messenger message on the official page.
 * Coalesces DB rows (max one unread per conversation / 90s) but still pushes
 * so the Super Admin mobile app receives each new alert.
 */
export async function notifyAdminOfficialInboxMessage(params: {
  conversationId: string;
  userId: string;
  userName?: string | null;
  preview: string;
}): Promise<void> {
  try {
    await ensureAdminNotificationsTable();

    const displayName =
      (params.userName && params.userName.trim()) ||
      (params.userId ? `زائر · ${params.userId.slice(-6)}` : 'زائر');
    const preview = (params.preview || '').trim().slice(0, 160) || 'رسالة جديدة';
    const title = 'رسالة جديدة — صفحة XO Bot';
    const message = `${displayName}: ${preview}`;
    const data = {
      conversationId: params.conversationId,
      userId: params.userId,
      userName: params.userName || null,
      source: 'official_facebook_page',
      kind: 'official_inbox',
    };

    const recent = await pool.query(
      `SELECT id FROM admin_notifications
       WHERE type = 'official_inbox'
         AND is_read = FALSE
         AND data->>'conversationId' = $1
         AND created_at > NOW() - INTERVAL '90 seconds'
       LIMIT 1`,
      [params.conversationId]
    );

    if (recent.rows.length > 0) {
      // Update preview on the existing row and still push to mobile
      await pool.query(
        `UPDATE admin_notifications
         SET message = $2, data = $3::jsonb
         WHERE id = $1`,
        [recent.rows[0].id, message, JSON.stringify(data)]
      );
      fanOutAdminPush({
        notificationId: String(recent.rows[0].id),
        type: 'official_inbox',
        title,
        message,
        data,
      });
      return;
    }

    await createAdminNotification({
      type: 'official_inbox',
      title,
      message,
      data,
    });
  } catch (error) {
    logger.warn('Official inbox admin notify failed', {
      conversationId: params.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
