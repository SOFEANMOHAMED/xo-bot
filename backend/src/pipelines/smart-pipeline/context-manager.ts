/**
 * Context Manager - Manage conversation context and state
 * Optimizes context for AI calls
 */

import type { Message, ConversationState, Entities, Intent, Stage } from '../../core/types.js';
import { logger } from '../../utils/logger.js';

// ==================== TYPES ====================

export interface ConversationContext {
  messages: Message[];
  state: ConversationState;
  entities: Entities;
  currentIntent?: Intent;
  currentStage?: Stage;
}

export interface ContextUpdateInput {
  currentMessage: string;
  intent: Intent;
  stage: Stage;
  entities: Entities;
  missingFields: string[];
  productIds?: string[];
}

// ==================== CONTEXT BUILDING ====================

/**
 * Build optimized context for AI
 * Reduces token usage while preserving important information
 */
export const buildContext = (
  recentMessages: Message[],
  conversationState: ConversationState,
  maxMessages: number = 10
): ConversationContext => {
  // Get recent messages, prioritizing user messages
  const optimizedMessages = optimizeMessages(recentMessages, maxMessages);

  // Merge entities from state and messages
  const entities = mergeEntities(
    conversationState.extracted_entities || {},
    extractEntitiesFromMessages(optimizedMessages)
  );

  return {
    messages: optimizedMessages,
    state: conversationState,
    entities,
    currentIntent: conversationState.last_intent,
    currentStage: undefined
  };
};

/**
 * Optimize messages for AI context
 */
const optimizeMessages = (messages: Message[], maxMessages: number): Message[] => {
  if (messages.length <= maxMessages) {
    return messages;
  }

  // Keep first message (context) + last N messages
  const firstMessage = messages[0];
  const recentMessages = messages.slice(-maxMessages + 1);

  // Remove duplicate consecutive messages
  const deduplicated = recentMessages.filter((msg, idx, arr) => {
    if (idx === 0) return true;
    const prev = arr[idx - 1];
    return !(msg.role === prev.role && msg.content === prev.content);
  });

  return [firstMessage, ...deduplicated];
};

/**
 * Extract entities from message history
 */
const extractEntitiesFromMessages = (messages: Message[]): Entities => {
  const entities: Entities = {};
  const allText = messages.map(m => m.content).join(' ');

  // Extract city
  const cities = ['دمشق', 'حلب', 'حمص', 'اللاذقية', 'طرطوس', 'حماة'];
  for (const city of cities) {
    if (allText.includes(city)) {
      entities.city = city;
      break;
    }
  }

  // Extract quantity
  const qtyMatch = allText.match(/(\d+)\s*(قطع|قطعة|حبة|units?|pcs?)/i);
  if (qtyMatch) {
    entities.quantity = parseInt(qtyMatch[1]);
  }

  return entities;
};

/**
 * Merge entities, preferring newer values
 */
const mergeEntities = (existing: Entities, extracted: Entities): Entities => {
  return {
    ...existing,
    ...Object.fromEntries(
      Object.entries(extracted).filter(([_, v]) => v !== undefined)
    )
  };
};

// ==================== STATE UPDATE ====================

/**
 * Update conversation state with new information
 */
export const updateContext = (
  currentState: ConversationState,
  update: ContextUpdateInput
): ConversationState => {
  const {
    currentMessage,
    intent,
    stage,
    entities,
    missingFields,
    productIds = []
  } = update;

  // Calculate lead score
  const leadScore = calculateLeadScore(stage, intent, entities);

  return {
    ...currentState,
    last_intent: intent,
    last_user_message: currentMessage,
    message_count: (currentState.message_count || 0) + 1,
    last_recommended_products: productIds.length > 0 
      ? productIds 
      : currentState.last_recommended_products,
    last_interaction: new Date().toISOString(),
    lead_score: leadScore,
    extracted_entities: mergeEntities(
      currentState.extracted_entities || {},
      entities
    ),
    missing_fields: missingFields,
    objection: currentState.objection
  };
};

/**
 * Calculate lead score based on engagement
 */
const calculateLeadScore = (
  stage: Stage,
  intent: Intent,
  entities: Entities
): number => {
  let score = 0;

  // Stage scoring
  const stageScores: Record<Stage, number> = {
    discover: 10,
    offer: 30,
    objection: 50,
    close: 80,
    handoff: 20,
    clarify: 15
  };
  score += stageScores[stage] || 10;

  // Intent scoring
  if (intent === 'order') score += 20;
  if (intent === 'price' || intent === 'availability') score += 10;

  // Entity scoring
  if (entities.city) score += 5;
  if (entities.quantity) score += 5;
  if (entities.product_id) score += 10;

  return Math.min(100, score);
};

// ==================== HISTORY ANALYSIS ====================

/**
 * Analyze conversation history for patterns
 */
export const analyzeHistory = (messages: Message[]): {
  avgResponseTime: number;
  totalMessages: number;
  userMessageRatio: number;
  hasComplaint: boolean;
  hasOrder: boolean;
} => {
  const userMessages = messages.filter(m => m.role === 'user');
  const hasComplaint = messages.some(m => 
    /شكوى|مشكلة|سيئ|complaint|problem/i.test(m.content)
  );
  const hasOrder = messages.some(m =>
    /أريد الطلب|بدي اطلب|order|شراء/i.test(m.content)
  );

  return {
    avgResponseTime: 0, // Would calculate from timestamps
    totalMessages: messages.length,
    userMessageRatio: userMessages.length / Math.max(1, messages.length),
    hasComplaint,
    hasOrder
  };
};

/**
 * Get conversation summary for handoff
 */
export const getConversationSummary = (
  messages: Message[],
  state: ConversationState
): string => {
  const userMessages = messages.filter(m => m.role === 'user');
  const lastMessages = userMessages.slice(-5).map(m => m.content);

  return `
Last Intent: ${state.last_intent || 'unknown'}
Message Count: ${state.message_count || 0}
Lead Score: ${state.lead_score || 0}
Recent User Messages:
${lastMessages.map((m, i) => `${i + 1}. ${m}`).join('\n')}
`.trim();
};

// ==================== PRODUCT CONTEXT ====================

/**
 * Get product ID from context
 */
export const getProductIdFromContext = (
  currentMessage: string,
  state: ConversationState,
  entities: Entities
): string | undefined => {
  // Priority 1: Explicit in current entities
  if (entities.product_id) {
    return entities.product_id;
  }

  // Priority 2: Last recommended if follow-up message or order intent without specific product
  const isFollowUp = /^(نعم|اي|تمام|ok|yes|هذا|هاد|أريد|بدي|ابي|عاوز|احجز|اطلب)/i.test(currentMessage.trim());
  const isOrderWithoutProduct = /(بدي|ابي|عاوز|اريد|حابب)\s+(اطلب|أطلب|طلب|احجز|حجز|اشتري)/i.test(currentMessage.trim());
  
  if ((isFollowUp || isOrderWithoutProduct) && !entities.product_query && state.last_recommended_products?.[0]) {
    return state.last_recommended_products[0];
  }

  return undefined;
};

/**
 * Check if user is referring to previous product
 */
export const isReferringToPreviousProduct = (
  message: string,
  state: ConversationState
): boolean => {
  const referencePatterns = [
    /^(هذا|هاد|هذي|نفسه|ياه|اياه)$/i,
    /^(الاول|الثاني|الثالث|first|second|third)$/i,
    /^(نعم|اي|تمام|ok|yes)$/i
  ];

  const hasReference = referencePatterns.some(p => p.test(message.trim()));
  const hasPreviousProducts = (state.last_recommended_products?.length || 0) > 0;

  return hasReference && hasPreviousProducts;
};
