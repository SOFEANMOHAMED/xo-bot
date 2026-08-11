/**
 * Simple Pipeline - Rule-based message processing
 * No AI calls - fast and cost-effective
 */

import type {
  Message,
  ConversationState,
  Intent,
  Stage,
  Language,
  MerchantConfig
} from '../../core/types.js';
import { handleGreeting, isPureGreeting } from './greeting-handler.js';
import { handleConfirmation, isSimpleConfirmation, isThanks } from './confirmation-handler.js';
import { logger } from '../../utils/logger.js';

// ==================== TYPES ====================

export interface SimplePipelineInput {
  merchantId: string;
  messageText: string;
  recentMessages: Message[];
  conversationState: ConversationState;
  merchantConfig: MerchantConfig;
}

export interface SimplePipelineResult {
  replyText: string;
  intent: Intent;
  stage: Stage;
  shouldContinueToSmart: boolean;
  language: Language;
}

// ==================== LANGUAGE DETECTION ====================

/**
 * Simple language detection
 */
const detectLanguage = (text: string): Language => {
  const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
  
  return arabicChars >= englishChars ? 'arabic' : 'english';
};

// ==================== MAIN PIPELINE ====================

/**
 * Process message through simple pipeline
 * Returns result or indicates to continue to smart pipeline
 */
export const processSimplePipeline = (
  input: SimplePipelineInput
): SimplePipelineResult => {
  const {
    merchantId,
    messageText,
    recentMessages,
    conversationState,
    merchantConfig
  } = input;

  const hasHistory = recentMessages.length > 0;
  const language = detectLanguage(messageText);
  const botLanguage = merchantConfig.botLanguage === 'auto' ? language : merchantConfig.botLanguage;

  logger.debug('Simple pipeline processing', {
    merchantId,
    messagePreview: messageText.substring(0, 30),
    hasHistory
  });

  // ==================== CHECK 1: Greeting ====================
  if (isPureGreeting(messageText)) {
    const greetingResult = handleGreeting(
      messageText,
      hasHistory,
      botLanguage,
      merchantConfig.storeName
    );

    if (!greetingResult.shouldContinue) {
      logger.info('Simple pipeline: handled greeting', { merchantId });
      
      return {
        replyText: greetingResult.replyText,
        intent: 'greeting',
        stage: 'discover',
        shouldContinueToSmart: false,
        language: botLanguage
      };
    }
  }

  // ==================== CHECK 2: Thanks ====================
  if (isThanks(messageText)) {
    const response = botLanguage === 'arabic'
      ? 'العفو! هل تحتاج مساعدة بشيء آخر؟'
      : 'You\'re welcome! Do you need help with anything else?';

    logger.info('Simple pipeline: handled thanks', { merchantId });

    return {
      replyText: response,
      intent: 'other',
      stage: conversationState.last_intent === 'order' ? 'close' : 'discover',
      shouldContinueToSmart: false,
      language: botLanguage
    };
  }

  // ==================== CHECK 3: Simple Confirmation ====================
  if (isSimpleConfirmation(messageText)) {
    const confirmResult = handleConfirmation(
      messageText,
      conversationState,
      botLanguage
    );

    // Some confirmations need smart pipeline (e.g., order confirmation)
    if (!confirmResult.shouldContinue && confirmResult.replyText) {
      logger.info('Simple pipeline: handled confirmation', { 
        merchantId, 
        type: confirmResult.type 
      });

      return {
        replyText: confirmResult.replyText,
        intent: confirmResult.type === 'no' ? 'other' : 'order',
        stage: confirmResult.type === 'no' ? 'discover' : 'close',
        shouldContinueToSmart: false,
        language: botLanguage
      };
    }

    // Continue to smart pipeline for context-aware handling
    if (confirmResult.shouldContinue) {
      return {
        replyText: '',
        intent: 'other',
        stage: 'discover',
        shouldContinueToSmart: true,
        language: botLanguage
      };
    }
  }

  // ==================== DEFAULT: Continue to Smart ====================
  logger.debug('Simple pipeline: forwarding to smart pipeline', { merchantId });

  return {
    replyText: '',
    intent: 'other',
    stage: 'discover',
    shouldContinueToSmart: true,
    language: botLanguage
  };
};

/**
 * Check if message can be handled by simple pipeline
 */
export const canHandleSimply = (messageText: string): boolean => {
  return isPureGreeting(messageText) || 
         isSimpleConfirmation(messageText) || 
         isThanks(messageText);
};

// Re-export handlers
export { handleGreeting, isPureGreeting } from './greeting-handler.js';
export { handleConfirmation, isSimpleConfirmation, isThanks } from './confirmation-handler.js';
