/**
 * Process eligible abandoned checkouts + product-interest reminders.
 */

import pool from '../../database/connection.js';
import { getProductById } from '../../catalog/product-search.js';
import { getCurrencyDisplayName } from '../../utils/currencyDisplayName.js';
import { logger } from '../../utils/logger.js';
import {
  ABANDONED_CHECKOUT_SOURCE,
  PRODUCT_INTEREST_SOURCE,
} from './constants.js';
import {
  claimAbandonedReminder,
  claimProductInterestReminder,
  findEligibleAbandonedConversations,
  findEligibleProductInterestConversations,
  markAbandonedReminderSent,
  markProductInterestReminderSent,
  releaseAbandonedReminderClaim,
  releaseProductInterestReminderClaim,
} from './finder.js';
import {
  buildAbandonedReminderMessage,
  buildProductInterestReminderMessage,
  extractBenefitsFromDescription,
} from './messageBuilder.js';
import { sendAbandonedReminderOutbound } from './outbound.js';
import type {
  EligibleAbandonedConversation,
  EligibleProductInterestConversation,
  ReminderCycleResult,
} from './types.js';

async function persistReminderMessage(
  conversationId: string,
  merchantId: string,
  text: string,
  source: string,
  type: string
): Promise<void> {
  const metadata = JSON.stringify({
    source,
    merchant_id: merchantId,
    type,
  });

  try {
    await pool.query(
      `INSERT INTO messages (conversation_id, role, content, sender_type, source, metadata)
       VALUES ($1, 'assistant', $2, 'bot', $3, $4::jsonb)`,
      [conversationId, text, source, metadata]
    );
  } catch (error: any) {
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

async function processCheckoutOne(
  conv: EligibleAbandonedConversation
): Promise<'sent' | 'failed' | 'skipped'> {
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
    await persistReminderMessage(
      conv.id,
      conv.merchant_id,
      text,
      ABANDONED_CHECKOUT_SOURCE,
      'abandoned_checkout_reminder'
    );
    await markAbandonedReminderSent(conv.id, conv.merchant_id);
  } catch (error) {
    logger.error('Abandoned reminder: persist after send failed', error as Error, {
      conversationId: conv.id,
      merchantId: conv.merchant_id,
    });
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

async function processProductInterestOne(
  conv: EligibleProductInterestConversation
): Promise<'sent' | 'failed' | 'skipped'> {
  const claimed = await claimProductInterestReminder(
    conv.id,
    conv.merchant_id,
    conv.product_id
  );
  if (!claimed) return 'skipped';

  const product = await getProductById(conv.merchant_id, conv.product_id);
  if (!product) {
    await releaseProductInterestReminderClaim(
      conv.id,
      conv.merchant_id,
      conv.product_id,
      'product_not_found'
    );
    return 'failed';
  }

  const entities = conv.conversation_state.extracted_entities || {};
  const name = entities.name || conv.user_name || '';
  const benefits = extractBenefitsFromDescription(product.description, 3);
  const currencyCode = product.currency || 'USD';
  const priceLabel =
    typeof product.price === 'number' && product.price > 0
      ? `${product.price} ${getCurrencyDisplayName(currencyCode, 'arabic')}`
      : null;

  const text = buildProductInterestReminderMessage({
    name,
    productName: product.name,
    benefits,
    priceLabel,
    customTemplate: conv.settings.product_interest_reminder_message,
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
    await releaseProductInterestReminderClaim(
      conv.id,
      conv.merchant_id,
      conv.product_id,
      'outbound_send_failed'
    );
    return 'failed';
  }

  try {
    await persistReminderMessage(
      conv.id,
      conv.merchant_id,
      text,
      PRODUCT_INTEREST_SOURCE,
      'product_interest_reminder'
    );
    await markProductInterestReminderSent(conv.id, conv.merchant_id, conv.product_id);
  } catch (error) {
    logger.error('Product interest reminder: persist after send failed', error as Error, {
      conversationId: conv.id,
      merchantId: conv.merchant_id,
      productId: conv.product_id,
    });
    await markProductInterestReminderSent(conv.id, conv.merchant_id, conv.product_id).catch(
      () => undefined
    );
    return 'failed';
  }

  logger.info('Product interest reminder sent', {
    conversationId: conv.id,
    merchantId: conv.merchant_id,
    platform: conv.platform,
    productId: conv.product_id,
  });

  return 'sent';
}

export async function runAbandonedCheckoutCycle(): Promise<ReminderCycleResult> {
  const result: ReminderCycleResult = {
    scanned: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    productInterestScanned: 0,
    productInterestSent: 0,
    productInterestFailed: 0,
    productInterestSkipped: 0,
  };

  const checkoutEligible = await findEligibleAbandonedConversations();
  result.scanned = checkoutEligible.length;

  if (checkoutEligible.length > 0) {
    logger.info('Abandoned checkout cycle: candidates found', {
      count: checkoutEligible.length,
    });
  }

  const checkoutConversationIds = new Set<string>();
  for (const conv of checkoutEligible) {
    try {
      const outcome = await processCheckoutOne(conv);
      if (outcome === 'sent') {
        result.sent += 1;
        checkoutConversationIds.add(conv.id);
      } else if (outcome === 'failed') result.failed += 1;
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

  const interestEligible = await findEligibleProductInterestConversations();
  // Checkout wins for the same conversation in this cycle
  const interestFiltered = interestEligible.filter(
    (c) => !checkoutConversationIds.has(c.id)
  );
  result.productInterestScanned = interestFiltered.length;

  if (interestFiltered.length > 0) {
    logger.info('Product interest cycle: candidates found', {
      count: interestFiltered.length,
    });
  }

  for (const conv of interestFiltered) {
    try {
      const outcome = await processProductInterestOne(conv);
      if (outcome === 'sent') result.productInterestSent = (result.productInterestSent || 0) + 1;
      else if (outcome === 'failed')
        result.productInterestFailed = (result.productInterestFailed || 0) + 1;
      else result.productInterestSkipped = (result.productInterestSkipped || 0) + 1;
    } catch (error) {
      result.productInterestFailed = (result.productInterestFailed || 0) + 1;
      logger.error('Product interest reminder: processOne exception', error as Error, {
        conversationId: conv.id,
        merchantId: conv.merchant_id,
        productId: conv.product_id,
      });
      await releaseProductInterestReminderClaim(
        conv.id,
        conv.merchant_id,
        conv.product_id,
        (error as Error).message
      ).catch(() => undefined);
    }
  }

  logger.info('Reminder cycle complete', result as unknown as Record<string, unknown>);
  return result;
}
