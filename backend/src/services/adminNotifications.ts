/**
 * Platform-level admin notifications (not merchant-scoped).
 * Used for official page inbox, billing alerts, etc.
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';

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

export async function createAdminNotification(params: {
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
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
    return result.rows[0]?.id ? String(result.rows[0].id) : null;
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
 * Coalesces to at most one unread notification per conversation within 90 seconds.
 */
export async function notifyAdminOfficialInboxMessage(params: {
  conversationId: string;
  userId: string;
  userName?: string | null;
  preview: string;
}): Promise<void> {
  try {
    await ensureAdminNotificationsTable();

    const recent = await pool.query(
      `SELECT id FROM admin_notifications
       WHERE type = 'official_inbox'
         AND is_read = FALSE
         AND data->>'conversationId' = $1
         AND created_at > NOW() - INTERVAL '90 seconds'
       LIMIT 1`,
      [params.conversationId]
    );
    if (recent.rows.length > 0) return;

    const displayName =
      (params.userName && params.userName.trim()) ||
      (params.userId ? `زائر · ${params.userId.slice(-6)}` : 'زائر');
    const preview = (params.preview || '').trim().slice(0, 160) || 'رسالة جديدة';

    await createAdminNotification({
      type: 'official_inbox',
      title: 'رسالة جديدة — صفحة XO Bot',
      message: `${displayName}: ${preview}`,
      data: {
        conversationId: params.conversationId,
        userId: params.userId,
        userName: params.userName || null,
        source: 'official_facebook_page',
      },
    });
  } catch (error) {
    logger.warn('Official inbox admin notify failed', {
      conversationId: params.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
