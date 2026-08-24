/**
 * Orchestrator - Main entry point for message processing
 * Routes all merchant bot traffic through SalesGPT (Full AI).
 */

import type {
  IncomingMessage,
  BotResponse,
  Message,
  ConversationState,
  MerchantConfig,
  Language
} from './types.js';
import { handleError, createBotError, logError } from './error-handler.js';
import { processWithSalesGPT } from '../services/salesgpt/index.js';
import { resetAICallsCount, getAICallsCount } from '../ai/gemini-client.js';
import { logger } from '../utils/logger.js';

// ==================== TYPES ====================

export interface OrchestratorInput {
  message: IncomingMessage;
  recentMessages: Message[];
  conversationState: ConversationState;
  merchantConfig: MerchantConfig;
}

export interface OrchestratorResult {
  response: BotResponse;
  updatedState: ConversationState;
}

// ==================== MAIN ORCHESTRATOR ====================

/**
 * Process incoming message through SalesGPT pipeline.
 */
export const processMessage = async (
  input: OrchestratorInput
): Promise<OrchestratorResult> => {
  const {
    message,
    recentMessages,
    conversationState,
    merchantConfig
  } = input;

  const startTime = Date.now();
  resetAICallsCount();

  logger.info('Orchestrator: Processing message', {
    merchantId: message.merchantId,
    platform: message.platform,
    messageLength: message.messageText.length,
  });

  try {
    const salesResult = await processWithSalesGPT({
      merchantId: message.merchantId,
      messageText: message.messageText,
      recentMessages,
      conversationState,
      merchantConfig,
      platform: message.platform
    });

    const processingTime = Date.now() - startTime;
    const aiCallsCount = getAICallsCount();

    const response: BotResponse = {
      replyText: salesResult.replyText,
      meta: {
        conversationId: '',
        intent: salesResult.intent,
        stage: salesResult.stage,
        pipelineUsed: 'smart',
        aiCallsCount,
        usedFallback: false,
        processingTimeMs: processingTime,
        next_action: salesResult.next_action
      }
    };

    logger.info('Orchestrator: Message processed', {
      merchantId: message.merchantId,
      intent: salesResult.intent,
      stage: salesResult.stage,
      pipelineUsed: 'smart',
      aiCallsCount,
      processingTimeMs: processingTime
    });

    return {
      response,
      updatedState: salesResult.updatedState
    };
  } catch (error) {
    const botError = createBotError(error, {
      merchantId: message.merchantId,
      platform: message.platform
    });
    logError(botError);

    const isArabic = /[\u0600-\u06FF]/.test(message.messageText);
    const language: Language = isArabic ? 'arabic' : 'english';

    const errorResult = handleError(error, language, {
      merchantId: message.merchantId
    });

    const response: BotResponse = {
      replyText: errorResult.message,
      meta: {
        conversationId: '',
        intent: 'other',
        stage: 'discover',
        pipelineUsed: 'smart',
        aiCallsCount: getAICallsCount(),
        usedFallback: true,
        processingTimeMs: Date.now() - startTime
      }
    };

    return {
      response,
      updatedState: conversationState
    };
  }
};

/**
 * Get default merchant config
 */
export const getDefaultMerchantConfig = (merchantId: string): MerchantConfig => ({
  merchantId,
  storeName: 'المتجر',
  storeCurrency: 'USD',
  persona: 'friendly',
  botLanguage: 'auto',
  use_full_ai_mode: true,
});

// ==================== EXPORTS ====================

export { handleError, createBotError } from './error-handler.js';
