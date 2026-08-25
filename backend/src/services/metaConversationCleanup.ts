/**
 * Delete channel conversations when a merchant unlinks an inbox channel.
 * SaaS-safe: always scoped by merchant_id; never touches other tenants.
 *
 * Messages cascade via FK ON DELETE CASCADE on conversations.
 * After delete, the merchant inbox is notified so an open UI drops the threads.
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';
import { notifyMerchantInboxChannelCleared } from './inbox/inboxRealtime.js';

export type ChannelConversationPlatform =
  | 'facebook_messenger'
  | 'instagram'
  | 'whatsapp'
  | 'telegram';

/**
 * Delete inbox conversations for a merchant channel.
 * - With accountId: only threads bound to that page / IG account / Telegram bot.
 * - Without accountId: all threads for the platform (full unlink).
 * - If accountId is set but the merchant has no remaining accounts for that
 *   channel family, also purge unbound legacy threads of that platform.
 */
export async function clearMerchantChannelConversations(params: {
  merchantId: string;
  platform: ChannelConversationPlatform;
  /** Facebook page_id, Instagram ig_user_id, Telegram bot id, WhatsApp account id */
  accountId?: string;
}): Promise<{ conversationsDeleted: number }> {
  const { merchantId, platform, accountId } = params;

  if (!merchantId) {
    return { conversationsDeleted: 0 };
  }

  let result;
  let purgedPlatform = !accountId;

  if (accountId) {
    result = await pool.query(
      `DELETE FROM conversations
       WHERE merchant_id = $1::uuid
         AND platform = $2::text
         AND (
           session_metadata->>'pageId' = $3::text
           OR session_metadata->>'channel_account_id' = $3::text
           OR conversation_state->'channel_binding'->>'account_id' = $3::text
           OR conversation_state->'channel_binding'->>'page_id' = $3::text
         )`,
      [merchantId, platform, accountId]
    );

    const stillLinked = await hasRemainingChannelAccount(merchantId, platform);
    if (!stillLinked) {
      const unbound = await pool.query(
        `DELETE FROM conversations
         WHERE merchant_id = $1::uuid
           AND platform = $2::text`,
        [merchantId, platform]
      );
      const conversationsDeleted =
        (result.rowCount || 0) + (unbound.rowCount || 0);
      logger.info('Cleared merchant channel conversations on disconnect', {
        merchantId,
        platform,
        accountId,
        conversationsDeleted,
        purgedUnbound: true,
      });
      await notifyMerchantInboxChannelCleared({
        merchantId,
        platform,
        purgedPlatform: true,
      });
      return { conversationsDeleted };
    }
  } else {
    result = await pool.query(
      `DELETE FROM conversations
       WHERE merchant_id = $1::uuid
         AND platform = $2::text`,
      [merchantId, platform]
    );
  }

  const conversationsDeleted = result.rowCount || 0;
  logger.info('Cleared merchant channel conversations on disconnect', {
    merchantId,
    platform,
    accountId: accountId ?? null,
    conversationsDeleted,
  });

  await notifyMerchantInboxChannelCleared({
    merchantId,
    platform,
    purgedPlatform,
  });

  return { conversationsDeleted };
}

export async function hasRemainingChannelAccount(
  merchantId: string,
  platform: ChannelConversationPlatform
): Promise<boolean> {
  if (platform === 'facebook_messenger') {
    const r = await pool.query(
      `SELECT 1 FROM facebook_pages WHERE merchant_id = $1::uuid LIMIT 1`,
      [merchantId]
    );
    return (r.rowCount || 0) > 0;
  }

  if (platform === 'instagram') {
    const r = await pool.query(
      `SELECT 1 FROM instagram_accounts WHERE merchant_id = $1::uuid LIMIT 1`,
      [merchantId]
    );
    return (r.rowCount || 0) > 0;
  }

  if (platform === 'whatsapp') {
    const r = await pool.query(
      `SELECT 1
       FROM (
         SELECT 1 FROM whatsapp_accounts WHERE merchant_id = $1::uuid
         UNION ALL
         SELECT 1 FROM whatsapp_web_sessions
          WHERE merchant_id = $1::uuid
            AND status IN ('connected', 'connecting', 'qr')
       ) linked
       LIMIT 1`,
      [merchantId]
    );
    return (r.rowCount || 0) > 0;
  }

  const r = await pool.query(
    `SELECT 1
     FROM (
       SELECT 1 FROM telegram_bots WHERE merchant_id = $1::uuid
       UNION ALL
       SELECT 1 FROM merchant_settings
        WHERE merchant_id = $1::uuid
          AND telegram_bot_token IS NOT NULL
          AND btrim(telegram_bot_token) <> ''
     ) linked
     LIMIT 1`,
    [merchantId]
  );
  return (r.rowCount || 0) > 0;
}
