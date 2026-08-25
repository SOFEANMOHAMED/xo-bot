/**
 * Shared persistence for inbox history import (Meta, WhatsApp Web, …).
 * SaaS-safe: every query is scoped by merchant_id.
 */

import pool from '../../database/connection.js';

export type InboxImportPlatform =
  | 'facebook_messenger'
  | 'instagram'
  | 'whatsapp'
  | 'telegram';

export async function getOrCreateImportedConversation(params: {
  merchantId: string;
  platform: InboxImportPlatform;
  userId: string;
  userName: string | null;
}): Promise<{ id: string; userName: string | null }> {
  const existing = await pool.query(
    `SELECT id, user_name
     FROM conversations
     WHERE merchant_id = $1 AND platform = $2 AND user_id = $3
     ORDER BY last_message_at DESC NULLS LAST
     LIMIT 1`,
    [params.merchantId, params.platform, params.userId]
  );

  if (existing.rows[0]) {
    return {
      id: existing.rows[0].id as string,
      userName: (existing.rows[0].user_name as string | null) || null,
    };
  }

  try {
    const inserted = await pool.query(
      `INSERT INTO conversations (
         merchant_id, platform, user_id, user_name, conversation_state, stage, status
       ) VALUES ($1, $2, $3, $4, '{}'::jsonb, 'discover', 'bot')
       RETURNING id, user_name`,
      [params.merchantId, params.platform, params.userId, params.userName]
    );
    return {
      id: inserted.rows[0].id as string,
      userName: (inserted.rows[0].user_name as string | null) || null,
    };
  } catch (error: any) {
    if (error?.code === '23505') {
      const again = await pool.query(
        `SELECT id, user_name
         FROM conversations
         WHERE merchant_id = $1 AND platform = $2 AND user_id = $3
         LIMIT 1`,
        [params.merchantId, params.platform, params.userId]
      );
      if (again.rows[0]) {
        return {
          id: again.rows[0].id as string,
          userName: (again.rows[0].user_name as string | null) || null,
        };
      }
    }
    throw error;
  }
}

export async function upsertImportedMessage(params: {
  conversationId: string;
  externalMessageId: string;
  role: 'user' | 'assistant';
  senderType: 'user' | 'human';
  source: string;
  content: string;
  createdAt: Date;
  metadata: Record<string, unknown>;
}): Promise<boolean> {
  const existing = await pool.query(
    `SELECT 1
     FROM messages
     WHERE conversation_id = $1::uuid
       AND external_message_id = $2::text
     LIMIT 1`,
    [params.conversationId, params.externalMessageId]
  );
  if ((existing.rowCount || 0) > 0) return false;

  try {
    const result = await pool.query(
      `INSERT INTO messages (
         conversation_id, role, content, sender_type, external_message_id, source, metadata, created_at
       ) VALUES (
         $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::jsonb, $8::timestamptz
       )
       RETURNING id`,
      [
        params.conversationId,
        params.role,
        params.content,
        params.senderType,
        params.externalMessageId,
        params.source,
        JSON.stringify(params.metadata),
        params.createdAt.toISOString(),
      ]
    );
    return (result.rowCount || 0) > 0;
  } catch (error: any) {
    if (error?.code === '23505') return false;
    throw error;
  }
}

export async function touchImportedConversationTimestamps(params: {
  conversationId: string;
  merchantId: string;
  userName: string | null;
  lastMessageAt: Date | null;
  source: string;
}): Promise<void> {
  await pool.query(
    `UPDATE conversations
     SET user_name = COALESCE(NULLIF($3::text, ''), user_name),
         last_message_at = CASE
           WHEN $4::timestamptz IS NULL THEN last_message_at
           WHEN last_message_at IS NULL OR last_message_at < $4::timestamptz THEN $4::timestamptz
           ELSE last_message_at
         END,
         session_metadata = COALESCE(session_metadata, '{}'::jsonb)
           || jsonb_build_object(
                'history_import',
                jsonb_build_object(
                  'at', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                  'source', $5::text
                )
              ),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1::uuid AND merchant_id = $2::uuid`,
    [
      params.conversationId,
      params.merchantId,
      params.userName,
      params.lastMessageAt ? params.lastMessageAt.toISOString() : null,
      params.source,
    ]
  );
}
