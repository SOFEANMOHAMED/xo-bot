/**
 * Orchestrator - Main entry point for message processing
 * Routes messages to appropriate pipeline and coordinates all components
 */

import type {
  IncomingMessage,
  BotResponse,
  Message,
  ConversationState,
  MerchantConfig,
  Language,
  Intent,
  Stage
} from './types.js';
import { routeToPipeline, type RoutingDecision } from './pipeline-router.js';
import { handleError, createBotError, logError } from './error-handler.js';
import { processSmartPipeline } from '../pipelines/smart-pipeline/index.js';
import { processSimplePipeline } from '../pipelines/simple-pipeline/index.js';
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
 * Process incoming message through orchestrator
 * 
 * Flow:
 * 1. Route to appropriate pipeline (simple or smart)
 * 2. Process through selected pipeline
 * 3. Return response with metadata
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
    // ==================== STEP 1: Check Full AI Mode ====================
    const useFullAIMode = process.env.ENABLE_FULL_AI_MODE === 'true' || merchantConfig.use_full_ai_mode || false;
    
    // ==================== STEP 2: Route to Pipeline ====================
    const routingDecision: RoutingDecision = routeToPipeline(
      message.messageText,
      conversationState,
      recentMessages,
      useFullAIMode  // ← Pass Full AI flag
    );

    console.log('🔀 Routing decision:', {
      useFullAIMode,
      pipeline: routingDecision.pipeline,
      reason: routingDecision.reason
    });

    logger.debug('Routing decision', {
      pipeline: routingDecision.pipeline,
      reason: routingDecision.reason,
      confidence: routingDecision.confidence
    });

    // ==================== STEP 2: Process Through Pipeline ====================
    let replyText: string;
    let intent: Intent = routingDecision.suggestedIntent || 'other';
    let stage: Stage = routingDecision.suggestedStage || 'discover';
    let updatedState = conversationState;
    let usedFallback = false;
    let language: Language = 'arabic';
    let next_action: string | undefined = undefined;

    if (routingDecision.pipeline === 'simple') {
      // Try simple pipeline first
      const simpleResult = processSimplePipeline({
        merchantId: message.merchantId,
        messageText: message.messageText,
        recentMessages,
        conversationState,
        merchantConfig
      });

      language = simpleResult.language;

      if (!simpleResult.shouldContinueToSmart) {
        // Simple pipeline handled it
        replyText = simpleResult.replyText;
        intent = simpleResult.intent;
        stage = simpleResult.stage;

        logger.info('Simple pipeline completed', {
          merchantId: message.merchantId,
          intent,
          processingTimeMs: Date.now() - startTime
        });
      } else {
        // Fall through to smart pipeline
        const smartResult = await processSmartPipeline({
          merchantId: message.merchantId,
          messageText: message.messageText,
          recentMessages,
          conversationState,
          merchantConfig,
          platform: message.platform
        });

        replyText = smartResult.replyText;
        intent = smartResult.intent;
        stage = smartResult.stage;
        updatedState = smartResult.updatedState;
        language = smartResult.language;
        next_action = smartResult.next_action;  // ✅ Capture next_action
      }
    } else {
      // Direct to smart pipeline
      const smartResult = await processSmartPipeline({
        merchantId: message.merchantId,
        messageText: message.messageText,
        recentMessages,
        conversationState,
        merchantConfig,
        platform: message.platform
      });

      replyText = smartResult.replyText;
      intent = smartResult.intent;
      stage = smartResult.stage;
      updatedState = smartResult.updatedState;
      language = smartResult.language;
      next_action = smartResult.next_action;  // ✅ Capture next_action
    }

    // ==================== STEP 3: Build Response ====================
    const processingTime = Date.now() - startTime;
    const aiCallsCount = getAICallsCount();

    const response: BotResponse = {
      replyText,
      meta: {
        conversationId: '', // Set by caller
        intent,
        stage,
        pipelineUsed: routingDecision.pipeline,
        aiCallsCount,
        usedFallback,
        processingTimeMs: processingTime,
        next_action  // ✅ Pass next_action to response
      }
    };

    logger.info('Orchestrator: Message processed', {
      merchantId: message.merchantId,
      intent,
      stage,
      pipelineUsed: routingDecision.pipeline,
      aiCallsCount,
      processingTimeMs: processingTime
    });

    return {
      response,
      updatedState
    };

  } catch (error) {
    // ==================== ERROR HANDLING ====================
    const botError = createBotError(error, {
      merchantId: message.merchantId,
      platform: message.platform
    });
    logError(botError);

    // Detect language for error message
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

// ==================== UTILITY FUNCTIONS ====================

/**
 * Quick greeting check (for fast path)
 */
export const isQuickGreeting = (messageText: string): boolean => {
  const patterns = [
    /^(السلام|مرحبا|أهلا|سلام|هلا|hello|hi|hey)[\s!،,.]*$/i
  ];
  return patterns.some(p => p.test(messageText.trim()));
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
  
});

// ==================== EXPORTS ====================

export { routeToPipeline } from './pipeline-router.js';
export { handleError, createBotError } from './error-handler.js';
export type { RoutingDecision } from './pipeline-router.js';
