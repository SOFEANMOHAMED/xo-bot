/**
 * Process eligible abandoned checkouts: claim → send → persist message → mark sent.
 */

import pool from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import { ABANDONED_CHECKOUT_SOURCE } from './constants.js';
import {
  claimAbandonedReminder,
  findEligibleAbandonedConversations,
  markAbandonedReminderSent,
  releaseAbandonedReminderClaim,
} from './finder.js';
import { buildAbandonedReminderMessage } from './messageBuilder.js';
import { sendAbandonedReminderOutbound } from './outbound.js';
import type { EligibleAbandonedConversation, ReminderCycleResult } from './types.js';

async function persistReminderMessage(
  conversationId: string,
  merchantId: string,
  text: string
): Promise<void> {
  const metadata = JSON.stringify({
    source: ABANDONED_CHECKOUT_SOURCE,
    merchant_id: merchantId,
    type: 'abandoned_checkout_reminder',
  });

  try {
    await pool.query(
      `INSERT INTO messages (conversation_id, role, content, sender_type, source, metadata)
       VALUES ($1, 'assistant', $2, 'bot', $3, $4::jsonb)`,
      [conversationId, text, ABANDONED_CHECKOUT_SOURCE, metadata]
    );
  } catch (error: any) {
    // Fallback if source check constraint / columns differ on older schemas
    if (error?.code === '23514' || error?.code === '42703') {
      await pool.query(
        `INSERT INTO messages (conversation_id, role, content, metadata)
         VALUES ($1, 'assistant', $2, $3::jsonb)`,
        [conversationId, text, metadata]
      );
      return;
    }
    throw error;
  }
}

async function processOne(conv: EligibleAbandonedConversation): Promise<'sent' | 'failed' | 'skipped'> {
  const claimed = await claimAbandonedReminder(conv.id, conv.merchant_id);
  if (!claimed) {
    return 'skipped';
  }

  const entities = conv.conversation_state.extracted_entities || {};
  const name = entities.name || conv.user_name || '';
  const productName = entities.product_query || null;

  const text = buildAbandonedReminderMessage({
    name,
    productName,
    customTemplate: conv.settings.abandoned_reminder_message,
  });

  const sent = await sendAbandonedReminderOutbound({
    merchantId: conv.merchant_id,
    platform: conv.platform,
    userId: conv.user_id,
    text,
    sessionMetadata: conv.session_metadata,
    conversationState: conv.conversation_state as unknown as Record<string, unknown>,
  });

  if (!sent) {
    await releaseAbandonedReminderClaim(conv.id, conv.merchant_id, 'outbound_send_failed');
    return 'failed';
  }

  try {
    await persistReminderMessage(conv.id, conv.merchant_id, text);
    await markAbandonedReminderSent(conv.id, conv.merchant_id);
  } catch (error) {
    logger.error('Abandoned reminder: persist after send failed', error as Error, {
      conversationId: conv.id,
      merchantId: conv.merchant_id,
    });
    // Message may already be with the customer — still mark sent to avoid spam
    await markAbandonedReminderSent(conv.id, conv.merchant_id).catch(() => undefined);
    return 'failed';
  }

  logger.info('Abandoned checkout reminder sent', {
    conversationId: conv.id,
    merchantId: conv.merchant_id,
    platform: conv.platform,
  });

  return 'sent';
}

export async function runAbandonedCheckoutCycle(): Promise<ReminderCycleResult> {
  const result: ReminderCycleResult = {
    scanned: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
  };

  const eligible = await findEligibleAbandonedConversations();
  result.scanned = eligible.length;

  if (eligible.length === 0) {
    return result;
  }

  logger.info('Abandoned checkout cycle: candidates found', { count: eligible.length });

  for (const conv of eligible) {
    try {
      const outcome = await processOne(conv);
      if (outcome === 'sent') result.sent += 1;
      else if (outcome === 'failed') result.failed += 1;
      else result.skipped += 1;
    } catch (error) {
      result.failed += 1;
      logger.error('Abandoned reminder: processOne exception', error as Error, {
        conversationId: conv.id,
        merchantId: conv.merchant_id,
      });
      await releaseAbandonedReminderClaim(
        conv.id,
        conv.merchant_id,
        (error as Error).message
      ).catch(() => undefined);
    }
  }

  logger.info('Abandoned checkout cycle complete', result as unknown as Record<string, unknown>);
  return result;
}
