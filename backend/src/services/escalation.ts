/**
 * Escalate a conversation from bot → human takeover.
 * Tenant-scoped: always filters by merchant_id.
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';
import { createMerchantNotification } from './merchantNotifications.js';
import {
  ensureConversationCustomerName,
  isPlaceholderCustomerName,
} from './socialProfile.js';
import { HANDOFF_STAGE_ID } from './salesgpt/conversationStateSync.js';

const PLATFORM_LABELS: Record<string, string> = {
  facebook_messenger: 'فيسبوك ماسنجر',
  facebook: 'فيسبوك',
  instagram: 'إنستغرام',
  telegram: 'تيليجرام',
  whatsapp: 'واتساب',
  web: 'المتجر / التجربة',
};

export interface EscalateConversationParams {
  merchantId: string;
  conversationId: string;
  platform?: string | null;
  userId?: string | null;
  userName?: string | null;
  reason?: string | null;
  /** Short customer-facing reply preview for the merchant inbox note */
  replyPreview?: string | null;
}

export interface EscalateConversationResult {
  escalated: boolean;
  alreadyHuman: boolean;
  notificationId: string | null;
}

/**
 * Disable bot for this conversation, mark status=human, notify merchant once.
 */
export async function escalateConversationToHuman(
  params: EscalateConversationParams
): Promise<EscalateConversationResult> {
  const { merchantId, conversationId } = params;

  if (!merchantId || !conversationId) {
    return { escalated: false, alreadyHuman: false, notificationId: null };
  }

  try {
    const updated = await pool.query(
      `UPDATE conversations
       SET bot_disabled = TRUE,
           status = 'human',
           last_human_response_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP,
           conversation_state = COALESCE(conversation_state, '{}'::jsonb)
             || jsonb_build_object(
                  'salesgpt_stage_id', $4::text,
                  'current_stage', 'handoff',
                  'escalated_at', to_jsonb(NOW()::text),
                  'escalation_reason', to_jsonb(COALESCE($3::text, 'customer_requested_human'))
                )
       WHERE id = $1
         AND merchant_id = $2
         AND (
           COALESCE(bot_disabled, FALSE) = FALSE
           OR COALESCE(status, 'bot') <> 'human'
         )
       RETURNING id, platform, user_id, user_name`,
      [conversationId, merchantId, params.reason || 'customer_requested_human', HANDOFF_STAGE_ID]
    );

    if ((updated.rowCount ?? 0) === 0) {
      logger.info('Escalation skipped — conversation already in human mode', {
        merchantId,
        conversationId,
      });
      return { escalated: false, alreadyHuman: true, notificationId: null };
    }

    const row = updated.rows[0];
    const platform = params.platform || row.platform || 'unknown';
    const userId = params.userId || row.user_id || '';
    const platformLabel = PLATFORM_LABELS[platform] || platform;

    // Also read checkout-collected name + channel binding from conversation state
    const stateRow = await pool.query(
      `SELECT conversation_state, session_metadata, user_name
       FROM conversations
       WHERE id = $1 AND merchant_id = $2`,
      [conversationId, merchantId]
    );
    const state = stateRow.rows[0]?.conversation_state || {};
    const sessionMeta = stateRow.rows[0]?.session_metadata || {};
    const collectedName =
      (state?.extracted_entities?.name as string | undefined)?.trim() || '';
    const preferredPageId =
      (state?.channel_binding?.page_id as string | undefined) ||
      (state?.channel_binding?.account_id as string | undefined) ||
      (sessionMeta?.pageId as string | undefined) ||
      (sessionMeta?.page_id as string | undefined) ||
      null;

    // Priority: checkout name → passed/DB name → Graph profile (FB/IG)
    let userName = (collectedName || params.userName || row.user_name || '').trim();
    if (
      userId &&
      isPlaceholderCustomerName(userName) &&
      (platform === 'facebook_messenger' || platform === 'facebook' || platform === 'instagram')
    ) {
      userName = await ensureConversationCustomerName({
        merchantId,
        conversationId,
        platform,
        userId,
        currentName: userName,
        preferredPageId,
      });
    }
    if (isPlaceholderCustomerName(userName)) {
      userName = 'عميل غير معروف';
    }

    const preview = (params.replyPreview || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const displayName = userName;
    const messageParts = [
      `اسم العميل: ${displayName}`,
      `المنصة: ${platformLabel}`,
      'طلب التحدث مع فريق المتجر — تم إيقاف الرد الآلي لهذه المحادثة. يُرجى المتابعة يدوياً.',
    ];
    if (preview) {
      messageParts.push(`معاينة آخر رد: ${preview}`);
    }

    const notificationId = await createMerchantNotification({
      merchantId,
      type: 'escalation',
      title: `تصعيد — ${displayName} عبر ${platformLabel}`,
      message: messageParts.join('\n'),
      data: {
        kind: 'escalation',
        conversationId,
        platform,
        platformLabel,
        userId,
        userName: displayName,
        reason: params.reason || 'customer_requested_human',
      },
    });

    logger.info('Conversation escalated to human', {
      merchantId,
      conversationId,
      platform,
      notificationId,
    });

    return { escalated: true, alreadyHuman: false, notificationId };
  } catch (error) {
    logger.error('Failed to escalate conversation', error as Error, {
      merchantId,
      conversationId,
    });
    return { escalated: false, alreadyHuman: false, notificationId: null };
  }
}

/**
 * Sanitize reply + escalate when needed. Safe to call from every channel controller.
 */
export async function finalizeOutboundBotReply(params: {
  replyText: string;
  nextAction?: string | null;
  merchantId: string;
  conversationId: string;
  platform?: string | null;
  userId?: string | null;
  userName?: string | null;
}): Promise<{ text: string; escalated: boolean }> {
  const { prepareBotReplyForCustomer } = await import('../response/sanitize-reply.js');
  const prepared = prepareBotReplyForCustomer(params.replyText, {
    nextAction: params.nextAction,
  });

  let escalated = false;
  if (prepared.shouldEscalate) {
    const result = await escalateConversationToHuman({
      merchantId: params.merchantId,
      conversationId: params.conversationId,
      platform: params.platform,
      userId: params.userId,
      userName: params.userName,
      reason: params.nextAction === 'handoff' ? 'handoff_action' : 'escalate_marker',
      replyPreview: prepared.text,
    });
    escalated = result.escalated || result.alreadyHuman;
  }

  return { text: prepared.text, escalated };
}
