/**
 * Bot Module - Main entry point for the new architecture
 * 
 * This module provides a clean, unified API for the bot system.
 * 
 * Architecture:
 * ├── core/           - Orchestrator, routing, error handling
 * ├── pipelines/      - Smart (AI) and Simple (rules) pipelines
 * ├── catalog/        - Product search and formatting
 * ├── sales/          - Sales rules and recommendations
 * ├── orders/         - Order validation and building
 * ├── response/       - Response building and templates
 * └── ai/             - OpenAI client and prompts
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
  isQuickGreeting,
  getDefaultMerchantConfig,
  routeToPipeline,
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
  RoutingDecision,
  PipelineType,
  ErrorType,
  BotError
} from '../core/index.js';

export { MANDATORY_ORDER_FIELDS } from '../core/index.js';

// ==================== PIPELINES ====================
export {
  processSmartPipeline,
  processSimplePipeline,
  detectIntent,
  canHandleSimply
} from '../pipelines/index.js';

export type {
  SmartPipelineInput,
  SmartPipelineResult,
  SimplePipelineInput,
  SimplePipelineResult,
  IntentDetectionResult
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

// ==================== SALES ====================
export {
  planSalesAction,
  getRecommendations
} from '../sales/index.js';

export type {
  SalesPlan,
  SalesPlanInput,
  RecommendationResult
} from '../sales/index.js';

// ==================== ORDERS ====================
export {
  validateOrder,
  buildOrderData,
  generateOrderDataTag,
  generateConfirmationMessage,
  generateOrderRequestMessage
} from '../orders/index.js';

export type {
  ValidationResult,
  BuildOrderInput
} from '../orders/index.js';

// ==================== RESPONSE ====================
export {
  buildResponse,
  buildGreetingResponse,
  buildErrorResponse,
  guardReply
} from '../response/index.js';

export type {
  ResponseBuilderInput,
  ResponseBuilderResult,
  GuardResult
} from '../response/index.js';

// ==================== AI ====================
export {
  isAIAvailable,
  generateContent,
  generateJSON,
  getAICallsCount,
  resetAICallsCount,
  buildSalesPrompt,
  buildIntentDetectionPrompt
} from '../ai/index.js';

// ==================== CONVENIENCE WRAPPER ====================

import type { Platform, MerchantConfig, BotResponse, ConversationState, Message } from '../core/types.js';
import { processMessage, getDefaultMerchantConfig } from '../core/orchestrator.js';

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
    pipelineUsed: 'smart' | 'simple';
    aiCallsCount: number;
    processingTimeMs: number;
  };
  updatedState: ConversationState;
  next_action?: string;  // For Full AI Mode order detection
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

  // Build full merchant config
  const merchantConfig: MerchantConfig = {
    ...getDefaultMerchantConfig(merchantId),
    ...partialConfig,
    merchantId
  };

  // Process message
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
      pipelineUsed: result.response.meta.pipelineUsed,
      aiCallsCount: result.response.meta.aiCallsCount,
      processingTimeMs: result.response.meta.processingTimeMs
    },
    updatedState: prepared.shouldEscalate
      ? {
          ...result.updatedState,
          current_stage: 'handoff'
        }
      : result.updatedState,
    next_action: result.response.meta.next_action,
    shouldEscalate: prepared.shouldEscalate
  };
};

// ==================== VERSION ====================
export const BOT_VERSION = '2.0.0';
export const ARCHITECTURE_NAME = 'XoBot Modular Architecture';
