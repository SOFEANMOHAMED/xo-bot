/**
 * Pipeline Router - Determines which pipeline to use
 * Optimizes AI costs by routing simple messages to rule-based handlers
 */

import type { Message, Entities, ConversationState, Intent, Stage } from './types.js';

// ==================== TYPES ====================

export type PipelineType = 'smart' | 'simple';

export interface RoutingDecision {
  pipeline: PipelineType;
  reason: string;
  confidence: number;
  suggestedIntent?: Intent;
  suggestedStage?: Stage;
}

// ==================== PATTERNS ====================

// Greeting patterns (Arabic + English)
const GREETING_PATTERNS = [
  /^(السلام عليكم|مرحبا|أهلاً|سلام|هلا|صباح الخير|مساء الخير|هاي|مرحب)[\s!،,.؟?]*$/i,
  /^(hello|hi|hey|good morning|good evening|greetings?)[\s!,.?]*$/i
];

// Order confirmation patterns
// ✅ ENHANCED: Accept variations with "بس" (only) and quantities
const ORDER_CONFIRMATION_PATTERNS = [
  /^(نعم|أيوا|أي|اي|تمام|موافق|ماشي|طيب|أكيد|بالتأكيد|اوكي|ok|okay|yes|yep|yeah|sure)(\s+(بس|فقط|وحدة|واحدة|١|1))?\s*[\d١-٩]*[\s!،,.؟?]*$/i,
  /^(بدي اطلب|أريد الطلب|اطلبلي|جهزلي|نفذ الطلب|أكد الطلب|confirm|order|place order)[\s!،,.]*$/i,
  /^(لك|ايه|اي)\s+(بس|فقط)\s+(وحدة|واحدة|١|1)/i  // "لك اي بس وحدة"
];

// Negative/Cancel patterns
const NEGATIVE_PATTERNS = [
  /^(لا|لأ|لا شكرا|مش موافق|ما بدي|no|nope|cancel|never mind)[\s!،,.؟?]*$/i
];

// Thank you patterns
const THANKS_PATTERNS = [
  /^(شكرا|شكراً|مشكور|يسلمو|يعطيك العافية|thank|thanks|thank you)[\s!،,.؟?]*$/i
];

// Price inquiry without product
const PRICE_INQUIRY_PATTERNS = [
  /كم (سعر|سعره|تكلفة|ثمن)/i,
  /ما (سعر|سعره|تكلفة|ثمن)/i,
  /(how much|what's the price|price of)/i
];

// Product catalog request
const CATALOG_PATTERNS = [
  /شو عندكم|ما عندكم|وش عندكم|ايش عندكم|فرجيني|عرضلي|وريني/i,
  /المنتجات المتوفرة|المنتجات الموجودة|قائمة المنتجات/i,
  /what do you have|show me|products available|catalog/i
];

// Complaint patterns
const COMPLAINT_PATTERNS = [
  /شكوى|مشكلة|سيئ|رديء|غش|نصب|حرام عليكم|عيب|زفت|complaint|problem|issue|terrible|awful/i
];

// ==================== HELPER FUNCTIONS ====================

/**
 * Check if message matches any pattern
 */
const matchesPatterns = (text: string, patterns: RegExp[]): boolean => {
  const trimmed = text.trim();
  return patterns.some(pattern => pattern.test(trimmed));
};

/**
 * Check if this is a simple greeting-only message
 */
const isSimpleGreeting = (text: string): boolean => {
  return matchesPatterns(text, GREETING_PATTERNS);
};

/**
 * Check if this is a simple confirmation
 */
const isSimpleConfirmation = (text: string): boolean => {
  return matchesPatterns(text, ORDER_CONFIRMATION_PATTERNS);
};

/**
 * Check if this is a simple negative response
 */
const isSimpleNegative = (text: string): boolean => {
  return matchesPatterns(text, NEGATIVE_PATTERNS);
};

/**
 * Check if this is a thank you message
 */
const isThanksMessage = (text: string): boolean => {
  return matchesPatterns(text, THANKS_PATTERNS);
};

/**
 * Check if this is a catalog request
 */
const isCatalogRequest = (text: string): boolean => {
  return matchesPatterns(text, CATALOG_PATTERNS);
};

/**
 * Check if this is a complaint
 */
const isComplaint = (text: string): boolean => {
  return matchesPatterns(text, COMPLAINT_PATTERNS);
};

/**
 * Check if message is very short (likely simple intent)
 */
const isVeryShort = (text: string): boolean => {
  const words = text.trim().split(/\s+/);
  return words.length <= 3;
};

// ==================== MAIN ROUTER ====================

/**
 * Route message to appropriate pipeline
 * 
 * Simple Pipeline (no AI):
 * - Pure greetings
 * - Simple yes/no confirmations
 * - Thank you messages
 * - Very short follow-ups in order stage
 * 
 * Smart Pipeline (uses AI):
 * - Product queries
 * - Complex questions
 * - Ambiguous messages
 * - New conversations
 */
export const routeToPipeline = (
  messageText: string,
  conversationState: ConversationState,
  recentMessages: Message[] = [],
  useFullAI: boolean = false
): RoutingDecision => {
  const text = messageText.trim();
  const hasHistory = recentMessages.length > 0;
  const lastIntent = conversationState.last_intent;
  const currentStage = conversationState.extracted_entities ? 'close' : 'discover';

  // ==================== RULE 0: Full AI Mode → ALWAYS Smart ====================
  // 🚨 CRITICAL: If Full AI Mode is enabled, ALL messages go to smart pipeline
  if (useFullAI) {
    return {
      pipeline: 'smart',
      reason: '🤖 Full AI Mode enabled - AI handles everything',
      confidence: 1.0,
      suggestedIntent: undefined,
      suggestedStage: undefined
    };
  }

  // ==================== RULE 1: Complaints → Smart (for proper handling) ====================
  if (isComplaint(text)) {
    return {
      pipeline: 'smart',
      reason: 'Complaint detected - needs AI for proper handling',
      confidence: 0.95,
      suggestedIntent: 'complaint',
      suggestedStage: 'handoff'
    };
  }

  // ==================== RULE 2: Catalog Request → Smart (needs product search) ====================
  if (isCatalogRequest(text)) {
    return {
      pipeline: 'smart',
      reason: 'Catalog request - needs product search',
      confidence: 0.9,
      suggestedIntent: 'browse',
      suggestedStage: 'discover'
    };
  }

  // ==================== RULE 3: Simple Greeting (no request) → Simple ====================
  if (isSimpleGreeting(text) && !hasHistory) {
    return {
      pipeline: 'simple',
      reason: 'Pure greeting - no AI needed',
      confidence: 0.95,
      suggestedIntent: 'greeting',
      suggestedStage: 'discover'
    };
  }

  // ==================== RULE 4: Returning greeting → Simple ====================
  if (isSimpleGreeting(text) && hasHistory) {
    return {
      pipeline: 'simple',
      reason: 'Returning greeting - simple response',
      confidence: 0.9,
      suggestedIntent: 'greeting',
      suggestedStage: currentStage === 'close' ? 'close' : 'discover'
    };
  }

  // ==================== RULE 5: Order stage confirmations → Simple ====================
  if (lastIntent === 'order' || currentStage === 'close') {
    if (isSimpleConfirmation(text)) {
      return {
        pipeline: 'simple',
        reason: 'Order confirmation - rule-based',
        confidence: 0.9,
        suggestedIntent: 'order',
        suggestedStage: 'close'
      };
    }

    if (isSimpleNegative(text)) {
      return {
        pipeline: 'simple',
        reason: 'Order cancellation - rule-based',
        confidence: 0.9,
        suggestedIntent: 'other',
        suggestedStage: 'discover'
      };
    }

    // Very short messages in order context are likely order info
    if (isVeryShort(text) && text.length > 5) {
      return {
        pipeline: 'smart',
        reason: 'Short order info - needs entity extraction',
        confidence: 0.7,
        suggestedIntent: 'order',
        suggestedStage: 'close'
      };
    }
  }

  // ==================== RULE 6: Thank you messages → Simple ====================
  if (isThanksMessage(text)) {
    return {
      pipeline: 'simple',
      reason: 'Thank you message - simple response',
      confidence: 0.9,
      suggestedIntent: 'other',
      suggestedStage: 'close'
    };
  }

  // ==================== RULE 7: Complex or ambiguous → Smart ====================
  // Default to smart pipeline for anything else
  return {
    pipeline: 'smart',
    reason: 'Complex message - needs AI analysis',
    confidence: 0.5,
    suggestedIntent: undefined,
    suggestedStage: undefined
  };
};

/**
 * Get routing statistics for monitoring
 */
export const getRoutingStats = (): { simple: number; smart: number } => {
  // This could be extended to track actual routing decisions
  return { simple: 0, smart: 0 };
};
