/**
 * Delete channel conversations when a Meta page/account is disconnected.
 * SaaS-safe: always scoped by merchant_id; never touches other tenants.
 *
 * Messages cascade via FK ON DELETE CASCADE on conversations.
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';

export type ChannelConversationPlatform = 'facebook_messenger' | 'instagram';

/**
 * Delete Messenger/Instagram conversations for a merchant.
 * - With accountId: only threads bound to that page / IG account.
 * - Without accountId: all threads for the platform.
 * - If accountId is set but the merchant has no remaining accounts for that
 *   channel family, also purge unbound legacy threads of that platform.
 */
export async function clearMerchantChannelConversations(params: {
  merchantId: string;
  platform: ChannelConversationPlatform;
  /** Facebook page_id or Instagram ig_user_id / linked page_id */
  accountId?: string;
}): Promise<{ conversationsDeleted: number }> {
  const { merchantId, platform, accountId } = params;

  if (!merchantId) {
    return { conversationsDeleted: 0 };
  }

  let result;

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

    // If merchant no longer has any linked account for this channel, also
    // remove legacy threads that were never bound to a page id.
    const stillLinked = await hasRemainingChannelAccount(merchantId, platform);
    if (!stillLinked) {
      const unbound = await pool.query(
        `DELETE FROM conversations
         WHERE merchant_id = $1::uuid
           AND platform = $2::text`,
        [merchantId, platform]
      );
      const deleted =
        (result.rowCount || 0) + (unbound.rowCount || 0);
      logger.info('Cleared merchant channel conversations on disconnect', {
        merchantId,
        platform,
        accountId,
        conversationsDeleted: deleted,
        purgedUnbound: true,
      });
      return { conversationsDeleted: deleted };
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

  return { conversationsDeleted };
}

async function hasRemainingChannelAccount(
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

  const r = await pool.query(
    `SELECT 1 FROM instagram_accounts WHERE merchant_id = $1::uuid LIMIT 1`,
    [merchantId]
  );
  return (r.rowCount || 0) > 0;
}
