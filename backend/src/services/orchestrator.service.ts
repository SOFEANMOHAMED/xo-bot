/**
 * Orchestrator Core - One orchestrator to serve all channels
 * Channel-agnostic message processing pipeline
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';
import {
  getOrCreateConversationHelper,
  getRecentMessages,
  appendMessage,
  patchConversationState,
  setConversationError
} from '../controllers/conversation.controller.js';
import {
  detectIntentAndEntities,
  type IntentDetectionResult
} from './intentDetector.js';
import { planSalesAction, type SalesPlan } from './salesPlanner.js';
import { generateSalesReply } from './hybridWriter.js';
import toolRegistry from './tools/toolRegistry.js';
import { guardReply } from './guard.service.js';

// ==================== TYPES ====================

export interface HandleIncomingMessageParams {
  merchantId: string;
  platform: 'facebook' | 'telegram' | 'web' | 'whatsapp' | 'instagram';
  userId: string;
  messageText: string;
  externalMessageId?: string;
  rawEventMetadata?: Record<string, any>; // channel-specific info
  userName?: string;
  merchantPolicies?: {
    storeName?: string;
    storeCurrency?: string;
    systemPrompt?: string;
    persona?: 'formal' | 'friendly' | 'sales' | 'fast' | 'luxury';
    shippingPolicy?: string;
    deliveryTime?: string;
    paymentMethods?: string;
    returnPolicy?: string;
    additionalNotes?: string;
  };
}

export interface OrchestratorResult {
  replyText: string;
  meta: {
    conversationId: string;
    intent: string;
    stage: string;
    toolResultsCount: number;
    usedFallback: boolean;
  };
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Categorize error type for appropriate handling
 */
const categorizeError = (error: any): 'rate_limit' | 'timeout' | 'api' | 'database' | 'unknown' => {
  const message = (error.message || '').toLowerCase();
  const code = error.code || error.status;
  
  // Rate limit errors
  if (code === 429 || message.includes('rate limit') || message.includes('too many requests')) {
    return 'rate_limit';
  }
  
  // Timeout errors
  if (code === 'ETIMEDOUT' || message.includes('timeout') || message.includes('timed out')) {
    return 'timeout';
  }
  
  // API errors (OpenAI, etc.)
  if (message.includes('api') || message.includes('network') || message.includes('fetch')) {
    return 'api';
  }
  
  // Database errors
  if (message.includes('database') || message.includes('postgres') || message.includes('sql')) {
    return 'database';
  }
  
  return 'unknown';
};

// ==================== MAIN ORCHESTRATOR ====================

/**
 * Handle incoming message through orchestrator pipeline
 * One orchestrator to serve all channels (Facebook, Telegram, future)
 * 
 * Steps:
 * 1) getOrCreateConversation
 * 2) getRecentMessages
 * 3) detectIntentAndEntities (Task 5)
 * 4) execute tools based on intent (toolRegistry + catalogTool)
 * 5) salesPlanner (Task 6)
 * 6) hybridWriter (Task 7) to generate reply
 * 7) guard: enforce ONE question + no hallucinated numbers
 * 8) appendMessage(user)
 * 9) appendMessage(assistant)
 * 10) patchConversationState
 * 11) return replyText
 * 
 * If orchestrator fails, fallback to legacy generateChatResponseHelper
 */
export const handleIncomingMessage = async (
  params: HandleIncomingMessageParams
): Promise<OrchestratorResult> => {
  const {
    merchantId,
    platform,
    userId,
    messageText,
    externalMessageId,
    rawEventMetadata = {},
    userName,
    merchantPolicies = {}
  } = params;

  let conversationId: string | undefined = undefined;
  let usedFallback = false;

  try {
    console.log('[Orchestrator] STEP 0: Starting message processing');
    logger.info('Orchestrator: Processing incoming message', {
      merchantId,
      platform,
      userId,
      messagePreview: messageText.substring(0, 50)
    });

    // ==================== STEP 1: Get or Create Conversation ====================
    console.log('[Orchestrator] STEP 1: Getting/creating conversation');
    const conversation = await getOrCreateConversationHelper({
      merchantId,
      platform: platform === 'facebook' ? 'facebook_messenger' : platform,
      userId
    });

    conversationId = conversation.id;
    console.log('[Orchestrator] STEP 1 DONE: conversation id =', conversationId);

    // ==================== STEP 2: Get Recent Messages (Optimized) ====================
    console.log('[Orchestrator] STEP 2: Getting recent messages');
    // ✅ زيادة حد الرسائل للحفاظ على سياق أفضل للمحادثة
    const messageCount = conversation.conversationState.message_count || 0;
    const messageLimit = Math.min(20, Math.max(10, messageCount)); // 10-20 messages (زيادة من 6-12)
    
    const recentMessages = await getRecentMessages(conversationId, messageLimit);
    recentMessages.reverse();
    const messageHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = 
      recentMessages.map(msg => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content
      }));
    console.log('[Orchestrator] STEP 2 DONE: Got', messageHistory.length, 'messages');

    // ==================== STEP 3: Detect Intent and Entities ====================
    console.log('[Orchestrator] STEP 3: Detecting intent');
    const detection: IntentDetectionResult = await detectIntentAndEntities({
      messageText,
      recentMessages: messageHistory,
      conversationState: conversation.conversationState,
      platform: platform === 'facebook' ? 'facebook_messenger' : platform,
      locale: 'ar',
      merchantId // Pass merchantId for dynamic product keywords
    });

    console.log('[Orchestrator] STEP 3 DONE: Intent =', detection.intent, 'entities =', JSON.stringify(detection.entities));
    logger.info('Orchestrator: Intent detected', {
      conversationId,
      intent: detection.intent,
      stage: detection.stage,
      objection: detection.objection,
      confidence: detection.confidence
    });

    // ==================== STEP 4: Execute Tools Based on Intent ====================
    console.log('[Orchestrator] STEP 4: Executing tools');
    const toolContext = {
      merchantId,
      platform: platform === 'facebook' ? 'facebook_messenger' : platform,
      conversationId
    };

    // ✅ تحسين منطق تحديد المنتج - مع دعم أفضل للسياق
    
    // ✅ أولاً: هل المستخدم يسأل عن الكتالوج/عرض المنتجات؟
    // يعتمد فقط على قرار الـ AI (intent/entities) بدون Regex
    const isAskingForCatalog =
      detection.intent === 'browse' ||
      detection.entities.wants_catalog === true;
    
    // ✅ إذا كان يسأل عن الكتالوج، نمسح السياق السابق ونعرض كل المنتجات
    let productQuery = '';
    let productId: string | undefined = undefined;
    
    if (isAskingForCatalog) {
      // ✅ عرض أفضل 5 منتجات - لا نستخدم أي سياق سابق
      productQuery = '';
      productId = undefined;
      console.log('[Orchestrator] Catalog request - showing top 5 products');
    } else if (detection.intent === 'greeting') {
      // عند التحية لا نحتاج منتجات
      productQuery = '';
      productId = undefined;
    } else {
      // استخدام المنتج من الكيانات المستخرجة أو السياق السابق
      productQuery = detection.entities.product_query || 
                     conversation.conversationState.extracted_entities?.product_query || '';
      
      productId = detection.entities.product_id;
      
      // ✅ إذا لم يوجد product_query وكانت الرسالة ليست قصيرة، استخدم الرسالة
      const shortMessagePatterns = /^(نعم|لا|تمام|ok|yes|no|موافق|agree|طيب|ماشي|حلو|شكرا|thanks|thank you|السلام|مرحبا|هلا)$/i;
      
      if (!productQuery && !shortMessagePatterns.test(messageText.trim()) && messageText.length > 5) {
        productQuery = messageText;
      }
      
      // ✅ استخدام product_id من السياق فقط للردود القصيرة/المتابعة
      if (!productId && conversation.conversationState.last_recommended_products?.length > 0) {
        const isFollowUp = messageText.length < 20 || 
          messageText.match(/^(نعم|اي|تمام|ok|yes|هذا|هاد|بدي|أريد|طلب)/i);
        
        if (isFollowUp) {
          productId = conversation.conversationState.last_recommended_products[0];
          console.log('[Orchestrator] Using product from context for follow-up:', productId);
        }
      }
    }
    
    // ✅ عند wants_catalog أو browse بدون query، نستخدم top products بدلاً من search
    let toolInput: any;
    if (isAskingForCatalog || (detection.intent === 'browse' && !productQuery)) {
      toolInput = {
        top: 5, // ✅ استخدام top products مباشرة
        ...detection.entities
      };
    } else {
      toolInput = {
        query: productQuery || '',
        productId,
        limit: 5, // ✅ حد أقصى 5 منتجات
        ...detection.entities
      };
    }
    
    // ✅ CRITICAL: إذا لم يكن هناك query ولا productId ولا top، نستخدم top products كـ fallback
    if (!toolInput.top && !toolInput.query && !toolInput.productId && detection.intent !== 'greeting') {
      toolInput = {
        top: 5,
        ...detection.entities
      };
      console.log('[Orchestrator] No query/productId found, using top products as fallback');
    }

    // Execute tools for detected intent
    const toolResults = await toolRegistry.executeToolsForIntent(
      detection.intent,
      toolInput,
      toolContext
    );

    console.log('[Orchestrator] STEP 4 DONE: Tools executed, count =', toolResults.length);
    const catalogToolResult = toolResults.find(r => r.name === 'catalog' && r.success);
    if (catalogToolResult) {
      console.log('[Orchestrator] Catalog tool result:', {
        success: catalogToolResult.success,
        productsCount: catalogToolResult.data?.products?.length || 0,
        products: catalogToolResult.data?.products?.map((p: any) => `${p.name} (${p.stock})`).join(', ') || 'none'
      });
    } else {
      console.log('[Orchestrator] ⚠️ NO CATALOG RESULT FOUND! All tools:', toolResults.map(r => ({ name: r.name, success: r.success })));
    }
    logger.info('Orchestrator: Tools executed', {
      conversationId,
      intent: detection.intent,
      toolResultsCount: toolResults.length,
      successfulTools: toolResults.filter(r => r.success).map(r => r.name)
    });

    // ==================== STEP 5: Sales Planner ====================
    console.log('[Orchestrator] STEP 5: Planning sales action');
    // Determine language for sales plan
    const userLanguage = detection.detectedLanguage === 'english' ? 'english' : 'arabic';
    
    const salesPlan: SalesPlan = planSalesAction({
      intent: detection.intent,
      stage: detection.stage,
      objection: detection.objection,
      entities: detection.entities,
      missing_fields: detection.missing_fields, // Pass missing_fields from intent detection
      conversationState: conversation.conversationState,
      toolResults,
      language: userLanguage // Pass detected language
    });

    console.log('[Orchestrator] STEP 5 DONE: Sales plan =', salesPlan.next_action);
    logger.info('Orchestrator: Sales plan generated', {
      conversationId,
      nextAction: salesPlan.next_action,
      ctaType: salesPlan.cta_type
    });

    // ==================== STEP 6: Hybrid Writer ====================
    console.log('[Orchestrator] STEP 6: Generating reply with hybridWriter');
    let replyText: string;
    try {
      replyText = await generateSalesReply({
        merchantId,
        platform: platform === 'facebook' ? 'facebook_messenger' : (platform === 'whatsapp' ? 'telegram' : (platform === 'instagram' ? 'facebook_messenger' : platform)),
        messageText,
        recentMessages: messageHistory,
        detection: {
          intent: detection.intent,
          stage: detection.stage,
          objection: detection.objection,
          entities: detection.entities,
          missing_fields: detection.missing_fields
        },
        plan: salesPlan,
        toolResults,
        conversationState: conversation.conversationState,
        merchantPolicies: {
          storeName: merchantPolicies.storeName || 'المتجر',
          storeCurrency: merchantPolicies.storeCurrency || 'USD',
          systemPrompt: merchantPolicies.systemPrompt,
          persona: merchantPolicies.persona || 'friendly',
          shippingPolicy: merchantPolicies.shippingPolicy,
          deliveryTime: merchantPolicies.deliveryTime,
          paymentMethods: merchantPolicies.paymentMethods,
          returnPolicy: merchantPolicies.returnPolicy,
          additionalNotes: merchantPolicies.additionalNotes
        }
      });
      console.log('[Orchestrator] STEP 6 DONE: Reply generated, length =', replyText.length, 'preview:', replyText.substring(0, 100));
    } catch (hybridWriterError: any) {
      console.log('[Orchestrator] STEP 6 FAILED:', hybridWriterError.message);
      logger.error('Orchestrator: Hybrid writer failed, using fallback', hybridWriterError as Error, {
        conversationId,
        error: hybridWriterError.message
      });
      usedFallback = true;
      throw hybridWriterError; // Will be caught by fallback handler
    }

    // ==================== STEP 7: Guard Checks ====================
    console.log('[Orchestrator] STEP 7: Running guard checks');
    const guardResult = guardReply({
      replyText,
      plan: salesPlan,
      toolResults,
      merchantPolicies: {
        shippingPolicy: merchantPolicies.shippingPolicy,
        deliveryTime: merchantPolicies.deliveryTime,
        paymentMethods: merchantPolicies.paymentMethods,
        returnPolicy: merchantPolicies.returnPolicy,
        storeCurrency: merchantPolicies.storeCurrency || 'USD'
      }
    });

    replyText = guardResult.replyText;

    if (!guardResult.passed) {
      logger.warn('Orchestrator: Guard checks failed', {
        conversationId,
        violations: guardResult.violations,
        warnings: guardResult.warnings,
        originalLength: replyText.length,
        finalLength: guardResult.replyText.length
      });
    } else if (guardResult.warnings.length > 0) {
      logger.info('Orchestrator: Guard checks passed with warnings', {
        conversationId,
        warnings: guardResult.warnings
      });
    }

    // ==================== STEP 8: Append User Message ====================
    if (conversationId) {
      await appendMessage(
        conversationId,
        'user',
        messageText,
        'user',
        externalMessageId,
        {
          platform,
          timestamp: new Date().toISOString(),
          confidence: detection.confidence,
          ...rawEventMetadata
        },
        detection.intent,
        detection.entities
      );

      // ==================== STEP 9: Append Assistant Message ====================
      await appendMessage(
        conversationId,
        'assistant',
        replyText,
        'bot',
        undefined,
        {
          platform,
          intent: detection.intent,
          stage: detection.stage,
          nextAction: salesPlan.next_action,
          toolResultsCount: toolResults.length,
          usedFallback
        },
        detection.intent,
        {
          recommended_products: toolResults
            .find(r => r.name === 'catalog' && r.success)
            ?.data?.products?.map((p: any) => ({ id: p.id, name: p.name })) || []
        }
      );
    }

    // ==================== STEP 10: Patch Conversation State ====================
    // Calculate lead score (simple: based on stage and intent)
    const leadScore = calculateLeadScore(detection.stage, detection.intent, detection.entities);

    // Extract product IDs from toolResults
    const catalogResult = toolResults.find(r => r.name === 'catalog' && r.success);
    const lastProductIds = catalogResult?.data?.products?.map((p: any) => p.id) || [];

    await patchConversationState(conversationId, {
      conversation_state: {
        last_intent: detection.intent,
        last_user_message: messageText,
        message_count: (conversation.conversationState.message_count || 0) + 1,
        last_recommended_products: lastProductIds,
        last_interaction: new Date().toISOString(),
        lead_score: leadScore,
        last_detection: {
          intent: detection.intent,
          stage: detection.stage,
          objection: detection.objection,
          entities: detection.entities,
          missing_fields: detection.missing_fields,
          confidence: detection.confidence,
          timestamp: new Date().toISOString()
        },
        extracted_entities: detection.entities,
        missing_fields: detection.missing_fields,
        objection: detection.objection,
        sales_plan: {
          next_action: salesPlan.next_action,
          cta_type: salesPlan.cta_type,
          recommendation_strategy: salesPlan.recommendation_strategy
        }
      },
      current_intent: detection.intent,
      stage: detection.stage,
      session_metadata: {
        ...conversation.sessionMetadata,
        last_platform: platform,
        last_update: new Date().toISOString(),
        detection_confidence: detection.confidence,
        orchestrator_version: '1.0'
      }
    });

    logger.info('Orchestrator: Message processed successfully', {
      conversationId,
      intent: detection.intent,
      stage: detection.stage,
      replyLength: replyText.length
    });

    return {
      replyText,
      meta: {
        conversationId,
        intent: detection.intent,
        stage: detection.stage,
        toolResultsCount: toolResults.length,
        usedFallback
      }
    };

  } catch (error: any) {
    // ==================== IMPROVED ERROR HANDLING ====================
    const errorType = categorizeError(error);
    
    logger.error('Orchestrator: Error processing message', error as Error, {
      merchantId,
      platform,
      userId,
      conversationId: conversationId || 'unknown',
      errorType,
      errorMessage: error.message
    });

    // Detect user language for error message
    const isArabic = /[\u0600-\u06FF]/.test(messageText);
    
    // Return user-friendly error message based on error type
    if (errorType === 'rate_limit') {
      return {
        replyText: isArabic 
          ? 'عذراً، هناك ضغط على الخدمة حالياً. يرجى المحاولة مرة أخرى بعد قليل.'
          : 'Sorry, the service is currently busy. Please try again shortly.',
        meta: {
          conversationId: conversationId || 'error',
          intent: 'error',
          stage: 'error',
          toolResultsCount: 0,
          usedFallback: false
        }
      };
    }
    
    if (errorType === 'timeout') {
      return {
        replyText: isArabic 
          ? 'استغرق الرد وقتاً طويلاً. كيف يمكنني مساعدتك؟'
          : 'The response took too long. How can I help you?',
        meta: {
          conversationId: conversationId || 'error',
          intent: 'error',
          stage: 'error',
          toolResultsCount: 0,
          usedFallback: false
        }
      };
    }
    const errorReply = isArabic
      ? 'عذراً، حدث خطأ في معالجة رسالتك. يرجى المحاولة مرة أخرى.'
      : 'Sorry, something went wrong while processing your message. Please try again.';

    if (conversationId && conversationId !== 'unknown') {
      await setConversationError(conversationId, `Orchestrator failed: ${error.message}`);
    }

    return {
      replyText: errorReply,
      meta: {
        conversationId: conversationId || 'unknown',
        intent: 'error',
        stage: 'discover',
        toolResultsCount: 0,
        usedFallback: false
      }
    };
  }
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Calculate simple lead score based on stage and intent
 * Returns 0-100 score
 */
const calculateLeadScore = (
  stage: string,
  intent: string,
  entities: Record<string, any>
): number => {
  let score = 0;

  // Stage-based scoring
  switch (stage) {
    case 'discover':
      score = 10;
      break;
    case 'offer':
      score = 30;
      break;
    case 'objection':
      score = 50; // Objection means interest
      break;
    case 'close':
      score = 80;
      break;
    case 'handoff':
      score = 20; // Lower score for handoff
      break;
    default:
      score = 10;
  }

  // Intent-based adjustments
  if (intent === 'order') {
    score += 20;
  } else if (intent === 'price' || intent === 'availability') {
    score += 10;
  }

  // Entity-based adjustments
  if (entities.city) score += 5;
  if (entities.quantity) score += 5;
  if (entities.product_id) score += 10;

  return Math.min(100, score);
};

// ==================== LEGACY EXPORT (for backward compatibility) ====================

/**
 * Legacy processMessage function - kept for backward compatibility
 * @deprecated Use handleIncomingMessage instead
 */
export const processMessage = async (params: any): Promise<string | null> => {
  logger.warn('processMessage is deprecated, use handleIncomingMessage instead');
  
  const result = await handleIncomingMessage({
    merchantId: params.merchantId,
    platform: params.platform === 'facebook_messenger' ? 'facebook' : params.platform,
    userId: params.userId,
    messageText: params.messageText,
    externalMessageId: params.externalMessageId,
    userName: params.userName,
    merchantPolicies: {
      storeName: params.storeName,
      storeCurrency: params.currency,
      shippingPolicy: params.shippingPolicy,
      deliveryTime: params.deliveryTime
    }
  });

  return result.replyText;
};

