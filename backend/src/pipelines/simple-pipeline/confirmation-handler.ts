/**
 * Confirmation Handler - Handle yes/no and simple confirmations
 * No AI needed for simple responses
 */

import type { Language, ConversationState } from '../../core/types.js';

// ==================== TYPES ====================

export interface ConfirmationResult {
  type: 'yes' | 'no' | 'thanks' | 'none';
  replyText: string;
  shouldContinue: boolean;
}

// ==================== PATTERNS ====================

const YES_PATTERNS = [
  // ✅ ENHANCED: Accept variations with "بس" (only/just) and numbers
  /^(نعم|أي|أيوا|ايوا|اي|تمام|موافق|ماشي|طيب|أكيد|بالتأكيد|اوكي|اكيد)(\s+(بس|فقط|وحدة|واحدة|١|1))?\s*[\d١-٩]*[\s!،,.؟?]*$/i,
  /^(ok|okay|yes|yep|yeah|sure|confirm|correct)(\s+(just|only|one))?\s*[\d]*[\s!,.?]*$/i,
  // Additional specific patterns
  /^(بس|فقط)\s+(نعم|اي|تمام|موافق)/i,  // "بس نعم"
  /^(نعم|اي)\s+(بس|فقط)\s*[\d١-٩]*/i   // "نعم بس ١"
];

const NO_PATTERNS = [
  /^(الغاء|إلغاء|الغاء الطلب|إلغاء الطلب|cancel|cancel order)[\s!،,.؟?]*$/i
];

const THANKS_PATTERNS = [
  /^(شكرا|شكراً|مشكور|يسلمو|يعطيك العافية|الله يعطيك العافية|لا شكرا|لا شكراً|لا شكرًا)[\s!،,.؟?]*$/i,
  /^(thank|thanks|thank you|thx|no thanks)[\s!,.?]*$/i
];

// ==================== DETECTION ====================

/**
 * Check if message is a simple confirmation
 */
export const isSimpleConfirmation = (messageText: string): boolean => {
  const text = messageText.trim();
  return YES_PATTERNS.some(p => p.test(text)) || 
         NO_PATTERNS.some(p => p.test(text));
};

/**
 * Check if message is yes
 */
export const isYes = (messageText: string): boolean => {
  return YES_PATTERNS.some(p => p.test(messageText.trim()));
};

/**
 * Check if message is no
 */
export const isNo = (messageText: string): boolean => {
  return NO_PATTERNS.some(p => p.test(messageText.trim()));
};

/**
 * Check if message is thanks
 */
export const isThanks = (messageText: string): boolean => {
  return THANKS_PATTERNS.some(p => p.test(messageText.trim()));
};

// ==================== HANDLERS ====================

/**
 * Handle confirmation message
 */
export const handleConfirmation = (
  messageText: string,
  conversationState: ConversationState,
  language: Language
): ConfirmationResult => {
  const text = messageText.trim();

  // Thanks message
  if (isThanks(text)) {
    const response = language === 'arabic'
      ? 'العفو! هل تحتاج مساعدة بشيء آخر؟'
      : 'You\'re welcome! Do you need help with anything else?';
    
    return {
      type: 'thanks',
      replyText: response,
      shouldContinue: false
    };
  }

  // Yes confirmation
  if (isYes(text)) {
    // Context-aware response based on last intent
    if (conversationState.last_intent === 'order') {
      // Continue order flow - need to go to smart pipeline
      return {
        type: 'yes',
        replyText: '',
        shouldContinue: true
      };
    }

    // Generic yes
    const response = language === 'arabic'
      ? 'تمام! كيف يمكنني مساعدتك؟'
      : 'Great! How can I help you?';
    
    return {
      type: 'yes',
      replyText: response,
      shouldContinue: true // Continue to handle the confirmation in context
    };
  }

  // No / Cancel
  if (isNo(text)) {
    // Cancel current flow
    const response = language === 'arabic'
      ? 'تمام، تم الإلغاء. هل تحتاج مساعدة بشيء آخر؟'
      : 'Okay, cancelled. Do you need help with anything else?';
    
    return {
      type: 'no',
      replyText: response,
      shouldContinue: false
    };
  }

  // Not a simple confirmation
  return {
    type: 'none',
    replyText: '',
    shouldContinue: true
  };
};

// ==================== CONTEXT-AWARE RESPONSES ====================

/**
 * Get confirmation response based on context
 */
export const getContextualConfirmation = (
  confirmationType: 'yes' | 'no',
  lastIntent: string | undefined,
  language: Language
): string => {
  if (confirmationType === 'no') {
    return language === 'arabic'
      ? 'تمام! هل تحتاج مساعدة بشيء آخر؟'
      : 'Okay! Do you need help with anything else?';
  }

  // Yes responses based on context
  switch (lastIntent) {
    case 'order':
      return language === 'arabic'
        ? 'ممتاز! سأجهز طلبك الآن.'
        : 'Great! I\'ll prepare your order now.';
    
    case 'browse':
    case 'product_query':
      return language === 'arabic'
        ? 'تمام! هل تريد رؤية المزيد من المنتجات؟'
        : 'Great! Would you like to see more products?';
    
    case 'price':
      return language === 'arabic'
        ? 'هل تريد الطلب الآن؟'
        : 'Would you like to order now?';
    
    default:
      return language === 'arabic'
        ? 'تمام! كيف يمكنني مساعدتك؟'
        : 'Great! How can I help you?';
  }
};
