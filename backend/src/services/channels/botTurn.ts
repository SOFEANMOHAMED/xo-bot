/**
 * Shared bot-turn helpers for all merchant sales channels.
 *
 * Controllers keep credentials / outbound send; this module owns:
 * - ORDER_DATA / IMAGE tag extraction
 * - SalesGPT turn (handleIncomingMessage + append + escalate + strip)
 * - Order persistence + conversation reset after confirm
 *
 * Every DB touch that accepts conversationId also requires merchantId (SaaS isolation).
 */

import type { Pool } from 'pg';
import {
  handleIncomingMessage,
  type ConversationState,
  type HandleMessageResult,
  type MerchantConfig,
  type Message,
  type Platform,
} from '../../bot/index.js';
import { appendOrderDataIfConfirmed } from '../buildMerchantBotConfig.js';
import {
  persistBotChannelOrder,
  resetConversationAfterOrder,
  type ChannelOrderLabels,
  type ChannelOrderSettings,
} from '../channelBotOrder.js';
import { escalateConversationToHuman } from '../escalation.js';
import { stripInternalControlMarkers } from '../../response/sanitize-reply.js';
import { logger } from '../../utils/logger.js';
import { conversationStageForDb } from '../salesgpt/conversationStateSync.js';

export { resetConversationAfterOrder };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUUID(str: string | null | undefined): boolean {
  if (!str) return false;
  return UUID_RE.test(str.trim());
}

/** Sanitize product UUIDs from model/ORDER_DATA — returns null if invalid. */
export function sanitizeUUID(str: string | null | undefined): string | null {
  if (!str) return null;
  const cleaned = str
    .trim()
    .replace(/--+/g, '-')
    .replace(/\s+/g, '')
    .toLowerCase();
  if (isValidUUID(cleaned)) return cleaned;
  return null;
}

export function extractImageUrl(text: string): { imageUrl: string | null; cleanText: string } {
  const imageRegex = /\[IMAGE:\s*([^\]]+)\]/i;
  const match = text.match(imageRegex);
  if (match?.[1]) {
    return {
      imageUrl: match[1].trim(),
      cleanText: text.replace(imageRegex, '').trim(),
    };
  }
  return { imageUrl: null, cleanText: text };
}

/**
 * Extract ORDER_DATA (canonical + alternate tag forms) and strip tags from customer text.
 * WhatsApp Web previously used a narrower regex — all channels now share this robust parser.
 */
export function extractOrderData(text: string): { orderData: any | null; cleanText: string } {
  const orderDataRegex = /\[ORDER_DATA\]([\s\S]*?)\[\/ORDER_DATA\]/gi;
  const altOrderDataRegex = /\[_?\/?ORDER_?DATA_?\]([\s\S]*?)\[\/?\s*_?\/?ORDER_?DATA_?\]/gi;
  const bracketTagRegex = /\[_\]([\s\S]*?)\[\/_\]/gi;

  const match =
    text.match(orderDataRegex) || text.match(altOrderDataRegex) || text.match(bracketTagRegex);

  const scrub = (raw: string): string => {
    let cleanText = raw.replace(orderDataRegex, '').trim();
    cleanText = cleanText.replace(altOrderDataRegex, '').trim();
    cleanText = cleanText.replace(bracketTagRegex, '').trim();
    cleanText = cleanText.replace(/\{[\s\S]{50,}?\}/g, '').trim();
    cleanText = cleanText.replace(/\[\s*\/?\s*(?:ORDER_?DATA|_)?\s*\]/gi, '').trim();
    cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();
    return cleanText;
  };

  if (match && match.length > 0) {
    try {
      const jsonMatch = match[0].match(/\[(?:ORDER_DATA|_)\]([\s\S]*?)\[\/(?:ORDER_DATA|_)\]/i);
      if (jsonMatch?.[1]) {
        const orderData = JSON.parse(jsonMatch[1].trim());
        return { orderData, cleanText: scrub(text) };
      }
    } catch (error) {
      logger.error('Error parsing ORDER_DATA from bot reply', error as Error);
    }
  }

  return { orderData: null, cleanText: scrub(text) };
}

export function isCompleteOrderPayload(orderData: any | null | undefined): boolean {
  return !!(
    orderData &&
    orderData.customerName &&
    orderData.customerPhone &&
    orderData.customerAddress &&
    Array.isArray(orderData.products) &&
    orderData.products.length > 0
  );
}

/**
 * Parse operational tags from a bot reply before outbound send.
 * Returns customer-facing text with ORDER_DATA / IMAGE removed (control markers already stripped upstream).
 */
export function parseBotReplyTags(responseText: string): {
  orderData: any | null;
  imageUrl: string | null;
  cleanText: string;
} {
  const { orderData, cleanText: withoutOrder } = extractOrderData(responseText);
  const { imageUrl, cleanText } = extractImageUrl(withoutOrder);
  return {
    orderData,
    imageUrl,
    cleanText: stripInternalControlMarkers(cleanText || withoutOrder),
  };
}

export interface PersistOrderIfPresentParams {
  pool: Pool;
  merchantId: string;
  conversationId: string;
  orderData: any;
  settings: ChannelOrderSettings;
  labels: ChannelOrderLabels;
  updatedState: ConversationState;
  /** When true, also write current_intent + stage (Instagram/Facebook style). */
  syncIntentAndStage?: boolean;
}

/**
 * Persist a complete ORDER_DATA payload and sync conversation_state (merchant-scoped).
 */
export async function persistOrderIfPresent(
  params: PersistOrderIfPresentParams
): Promise<boolean> {
  const {
    pool,
    merchantId,
    conversationId,
    orderData,
    settings,
    labels,
    updatedState,
    syncIntentAndStage = true,
  } = params;

  if (!isCompleteOrderPayload(orderData)) return false;

  const orderPersisted = await persistBotChannelOrder(
    pool,
    merchantId,
    orderData,
    settings,
    sanitizeUUID,
    labels,
    updatedState
  );

  if (!orderPersisted) return false;

  if (syncIntentAndStage) {
    await pool.query(
      `UPDATE conversations
       SET conversation_state = $1,
           current_intent = $2,
           stage = $3,
           last_message_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND merchant_id = $5`,
      [
        JSON.stringify(updatedState),
        updatedState.last_intent || 'greeting',
        conversationStageForDb(updatedState),
        conversationId,
        merchantId,
      ]
    );
  } else {
    await pool.query(
      `UPDATE conversations
       SET conversation_state = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND merchant_id = $3`,
      [JSON.stringify(updatedState), conversationId, merchantId]
    );
  }

  return true;
}

export interface RunSalesBotTurnParams {
  merchantId: string;
  /** Passed to handleIncomingMessage */
  platform: Platform;
  /** Stored on escalation / message metadata */
  escalatePlatform: string;
  userId: string;
  userName: string;
  messageText: string;
  externalMessageId?: string;
  recentMessages: Message[];
  conversationState: ConversationState;
  merchantConfig: Partial<MerchantConfig>;
  conversationId: string;
  storeCurrency: string;
  /** @deprecated Unused — channel is stored on orders.source, not in notes. */
  channelLabel?: string;
  pool: Pool;
  /** Extra metadata on the saved user message row */
  userMessageMetadata?: Record<string, unknown>;
  /** Extra metadata on the saved assistant message row */
  assistantMessageMetadata?: Record<string, unknown>;
  /** When false, caller saves messages itself (legacy paths). Default true. */
  persistMessages?: boolean;
}

export interface RunSalesBotTurnResult {
  responseText: string;
  updatedState: ConversationState;
  meta: HandleMessageResult['meta'];
  next_action?: string;
  shouldEscalate?: boolean;
  /** True when orchestrator threw; responseText is a fallback error string */
  failed: boolean;
}

/**
 * Shared SalesGPT turn: handleIncomingMessage → append ORDER_DATA → escalate → strip markers → save.
 * Does not send outbound — caller still owns transport.
 */
export async function runSalesBotTurn(
  params: RunSalesBotTurnParams
): Promise<RunSalesBotTurnResult> {
  const {
    merchantId,
    platform,
    escalatePlatform,
    userId,
    userName,
    messageText,
    externalMessageId,
    recentMessages,
    conversationState,
    merchantConfig,
    conversationId,
    storeCurrency,
    pool,
    userMessageMetadata,
    assistantMessageMetadata,
    persistMessages = true,
  } = params;

  try {
    const result = await handleIncomingMessage({
      merchantId,
      platform,
      userId,
      userName,
      messageText,
      externalMessageId: externalMessageId || '',
      recentMessages,
      conversationState,
      merchantConfig,
    });

    let responseText = result.replyText;
    const updatedState = result.updatedState;
    const entities = updatedState.extracted_entities || {};
    const products = updatedState.last_recommended_products || [];

    responseText = appendOrderDataIfConfirmed({
      responseText,
      nextAction: result.next_action,
      entities,
      productIds: products,
      storeCurrency,
      cartItems: updatedState.cart?.items,
    });

    if (result.shouldEscalate) {
      await escalateConversationToHuman({
        merchantId,
        conversationId,
        platform: escalatePlatform,
        userId,
        userName,
        reason: result.next_action === 'handoff' ? 'handoff_action' : 'escalate_marker',
        replyPreview: responseText,
      });
    }

    responseText = stripInternalControlMarkers(responseText);

    if (persistMessages) {
      try {
        await pool.query(
          `INSERT INTO messages (conversation_id, role, content, metadata, intent, entities)
           SELECT $1, 'user', $2, $3, $4, $5
           FROM conversations WHERE id = $1 AND merchant_id = $6`,
          [
            conversationId,
            messageText,
            JSON.stringify({
              platform: escalatePlatform,
              timestamp: new Date().toISOString(),
              externalId: externalMessageId || null,
              ...(userMessageMetadata || { type: 'text' }),
            }),
            result.meta.intent,
            JSON.stringify({}),
            merchantId,
          ]
        );

        await pool.query(
          `INSERT INTO messages (conversation_id, role, content, metadata, intent, entities)
           SELECT $1, 'assistant', $2, $3, $4, $5
           FROM conversations WHERE id = $1 AND merchant_id = $6`,
          [
            conversationId,
            responseText,
            JSON.stringify({
              platform: escalatePlatform,
              pipelineUsed: result.meta.pipelineUsed,
              aiCallsCount: result.meta.aiCallsCount,
              processingTimeMs: result.meta.processingTimeMs,
              ...(assistantMessageMetadata || {}),
            }),
            result.meta.intent,
            JSON.stringify({}),
            merchantId,
          ]
        );

        await pool.query(
          `UPDATE conversations
           SET conversation_state = $1,
               current_intent = $2,
               stage = $3,
               last_message_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $4 AND merchant_id = $5`,
          [
            JSON.stringify(updatedState),
            result.meta.intent,
            conversationStageForDb(updatedState),
            conversationId,
            merchantId,
          ]
        );
      } catch (saveError) {
        logger.error('Failed to save messages after SalesGPT turn', saveError as Error, {
          merchantId,
          conversationId,
          platform: escalatePlatform,
        });
      }
    }

    return {
      responseText,
      updatedState,
      meta: result.meta,
      next_action: result.next_action,
      shouldEscalate: result.shouldEscalate,
      failed: false,
    };
  } catch (orchestratorError) {
    logger.error('SalesGPT turn failed', orchestratorError as Error, {
      merchantId,
      conversationId,
      platform: escalatePlatform,
      userId,
    });

    const responseText = 'عذراً، حدث خطأ في معالجة رسالتك. يرجى المحاولة مرة أخرى.';

    if (persistMessages) {
      try {
        await pool.query(
          `INSERT INTO messages (conversation_id, role, content)
           SELECT $1, 'user', $2 FROM conversations WHERE id = $1 AND merchant_id = $3`,
          [conversationId, messageText, merchantId]
        );
        await pool.query(
          `INSERT INTO messages (conversation_id, role, content)
           SELECT $1, 'assistant', $2 FROM conversations WHERE id = $1 AND merchant_id = $3`,
          [conversationId, responseText, merchantId]
        );
      } catch (saveError) {
        logger.error('Failed to save messages after SalesGPT failure', saveError as Error);
      }
    }

    return {
      responseText,
      updatedState: conversationState,
      meta: {
        intent: 'other',
        stage: 'discover',
        pipelineUsed: 'smart',
        aiCallsCount: 0,
        processingTimeMs: 0,
      },
      failed: true,
    };
  }
}
