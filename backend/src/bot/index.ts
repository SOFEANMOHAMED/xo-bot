/**
 * Bot Module - Main entry point for the new architecture
 *
 * Architecture:
 * ├── core/           - Orchestrator, error handling
 * ├── pipelines/      - SalesGPT pipeline wrapper
 * ├── catalog/        - Product search and formatting
 * ├── orders/         - Order persistence
 * ├── response/       - Reply sanitization
 * └── ai/             - OpenAI client
 *
 * Usage:
 * ```typescript
 * import { handleIncomingMessage } from './bot';
 *
 * const result = await handleIncomingMessage({
 *   merchantId: 'merchant-123',
 *   platform: 'telegram',
 *   userId: 'user-456',
 *   messageText: 'مرحبا',
 *   merchantConfig: { storeName: 'متجري', ... }
 * });
 * ```
 */

// ==================== CORE ====================
export {
  processMessage,
  getDefaultMerchantConfig,
  handleError,
  createBotError,
  logError,
  categorizeError,
  getErrorMessage,
  withRetry
} from '../core/index.js';

export type {
  Language,
  DetectedLanguage,
  Intent,
  Stage,
  Objection,
  CtaType,
  NextAction,
  RecommendationStrategy,
  Platform,
  Persona,
  Entities,
  MerchantConfig,
  Message,
  ConversationState,
  IncomingMessage,
  BotResponse,
  Product,
  OrderData,
  ErrorType,
  BotError
} from '../core/index.js';

export { MANDATORY_ORDER_FIELDS } from '../core/index.js';

// ==================== PIPELINES ====================
export {
  processSmartPipeline
} from '../pipelines/index.js';

export type {
  SmartPipelineInput,
  SmartPipelineResult
} from '../pipelines/index.js';

// ==================== CATALOG ====================
export {
  searchProducts,
  getProductById,
  getTopProducts,
  formatProducts,
  formatProduct,
  renderProducts,
  clearProductCache
} from '../catalog/index.js';

// ==================== ORDERS ====================
export { generateOrderId } from '../orders/index.js';

export type {
  StoredOrder,
  OrderStatus,
  CreateOrderInput,
  OrderQuery
} from '../orders/index.js';

// ==================== RESPONSE ====================
export {
  prepareBotReplyForCustomer,
  detectEscalationMarker,
  stripInternalControlMarkers,
  sanitizeCaptionWhenImageSent,
  stripFalseImageDeliveryClaims
} from '../response/index.js';

export type { PreparedBotReply } from '../response/index.js';

// ==================== AI ====================
export {
  isAIAvailable,
  generateContent,
  generateJSON,
  getAICallsCount,
  resetAICallsCount
} from '../ai/index.js';

// ==================== CONVENIENCE WRAPPER ====================

import type { Platform, MerchantConfig, BotResponse, ConversationState, Message } from '../core/types.js';
import { processMessage, getDefaultMerchantConfig } from '../core/orchestrator.js';
import { applyHandoffStage } from '../services/salesgpt/conversationStateSync.js';

/**
 * High-level wrapper for handling incoming messages
 * This is the main entry point for integrations
 */
export interface HandleMessageParams {
  merchantId: string;
  platform: Platform;
  userId: string;
  messageText: string;
  externalMessageId?: string;
  userName?: string;
  recentMessages?: Message[];
  conversationState?: ConversationState;
  merchantConfig?: Partial<MerchantConfig>;
}

export interface HandleMessageResult {
  replyText: string;
  meta: {
    intent: string;
    stage: string;
    pipelineUsed: 'smart';
    aiCallsCount: number;
    processingTimeMs: number;
  };
  updatedState: ConversationState;
  next_action?: string;
  /** True when reply contained <ESCALATE> or next_action is handoff */
  shouldEscalate?: boolean;
}

/**
 * Handle incoming message - main entry point
 */
export const handleIncomingMessage = async (
  params: HandleMessageParams
): Promise<HandleMessageResult> => {
  const {
    merchantId,
    platform,
    userId,
    messageText,
    externalMessageId,
    userName,
    recentMessages = [],
    conversationState = { message_count: 0 },
    merchantConfig: partialConfig = {}
  } = params;

  const merchantConfig: MerchantConfig = {
    ...getDefaultMerchantConfig(merchantId),
    ...partialConfig,
    merchantId
  };

  const result = await processMessage({
    message: {
      merchantId,
      platform,
      userId,
      messageText,
      externalMessageId,
      userName
    },
    recentMessages,
    conversationState,
    merchantConfig
  });

  const { prepareBotReplyForCustomer } = await import('../response/sanitize-reply.js');
  const prepared = prepareBotReplyForCustomer(result.response.replyText, {
    nextAction: result.response.meta.next_action
  });

  return {
    replyText: prepared.text,
    meta: {
      intent: result.response.meta.intent,
      stage: prepared.shouldEscalate ? 'handoff' : result.response.meta.stage,
      pipelineUsed: 'smart',
      aiCallsCount: result.response.meta.aiCallsCount,
      processingTimeMs: result.response.meta.processingTimeMs
    },
    updatedState: prepared.shouldEscalate
      ? applyHandoffStage({ ...result.updatedState })
      : result.updatedState,
    next_action: result.response.meta.next_action,
    shouldEscalate: prepared.shouldEscalate
  };
};

// ==================== VERSION ====================
export const BOT_VERSION = '2.1.0';
export const ARCHITECTURE_NAME = 'XoBot SalesGPT Architecture';
