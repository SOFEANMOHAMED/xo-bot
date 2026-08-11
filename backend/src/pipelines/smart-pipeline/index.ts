/**
 * Smart Pipeline - AI-powered message processing
 * Uses AI for intent detection and response generation
 */

import type {
  Message,
  ConversationState,
  Intent,
  Stage,
  Entities,
  Product,
  Language,
  MerchantConfig
} from '../../core/types.js';
import { detectIntent, type IntentDetectionResult } from './intent-detector.js';
import { buildContext, updateContext, getProductIdFromContext } from './context-manager.js';
import { searchProducts, getTopProducts, getProductById } from '../../catalog/product-search.js';
import { resolveColorEntity } from '../../catalog/color-options.js';
import { planSalesAction, type SalesPlan } from '../../sales/sales-rules.js';
import { buildResponse } from '../../response/response-builder.js';
import { logger } from '../../utils/logger.js';
import { processWithSalesGPT } from '../../services/salesgpt/index.js';

// ==================== TYPES ====================

export interface SmartPipelineInput {
  merchantId: string;
  messageText: string;
  recentMessages: Message[];
  conversationState: ConversationState;
  merchantConfig: MerchantConfig;
  platform?: string;
}

export interface SmartPipelineResult {
  replyText: string;
  intent: Intent;
  stage: Stage;
  entities: Entities;
  missingFields: string[];
  products: Product[];
  plan: SalesPlan;
  updatedState: ConversationState;
  aiCallsCount: number;
  language: Language;
  next_action?: string;  // For Full AI Mode order detection
}

// ==================== MAIN PIPELINE ====================

/**
 * Process message through smart pipeline
 */
export const processSmartPipeline = async (
  input: SmartPipelineInput
): Promise<SmartPipelineResult> => {
  const {
    merchantId,
    messageText,
    recentMessages,
    conversationState,
    merchantConfig,
    platform
  } = input;

  let aiCallsCount = 0;
  const startTime = Date.now();

  // Check if Full AI Mode is enabled (env variable or merchant config)
  const useFullAIMode = process.env.ENABLE_FULL_AI_MODE === 'true' || merchantConfig.use_full_ai_mode || false;

  logger.info('Smart pipeline started', {
    merchantId,
    messagePreview: messageText.substring(0, 50),
    useFullAI: useFullAIMode
  });

  // ==================== CHECK: Use Full AI Mode? ====================
  // إذا التاجر فعّل وضع AI الكامل، استخدم SalesGPT Brain
  if (useFullAIMode) {
    console.log('🧠 Using SalesGPT BRAIN - Professional Sales Agent Mode');
    const salesGPTResult = await processWithSalesGPT({
      merchantId,
      messageText,
      recentMessages,
      conversationState,
      merchantConfig,
      platform
    });
    return salesGPTResult;
  }

  // Otherwise, use hybrid approach (current system)
  console.log('🔀 Using HYBRID MODE (current system)');

  // ==================== STEP 1: Build Context ====================
  const context = buildContext(recentMessages, conversationState);

  // ==================== STEP 2: Detect Intent ====================
  const detection: IntentDetectionResult = await detectIntent({
    messageText,
    recentMessages: context.messages,
    conversationState,
    merchantId,
    platform
  });
  aiCallsCount++;

  const intent = detection.intent;
  const stage = detection.stage;

  // ✅ CRITICAL FIX: Smart merge - preserve values from history unless new value is explicitly provided
  // This prevents undefined values from overwriting existing color/size data
  const entities: Entities = {
    ...(conversationState.extracted_entities || {}),
    ...detection.entities
  };

  // 🚀 SMART MERGE: Only override with detection values if they're NOT undefined
  // This preserves color/size from previous messages
  const historyEntities = conversationState.extracted_entities || {};
  if (detection.entities.color === undefined && historyEntities.color) {
    entities.color = historyEntities.color;
  }
  if (detection.entities.size === undefined && historyEntities.size) {
    entities.size = historyEntities.size;
  }
  // Preserve other important fields
  if (detection.entities.product_query === undefined && historyEntities.product_query) {
    entities.product_query = historyEntities.product_query;
  }

  console.log('🔗 Merged entities (SMART)', {
    fromHistory: conversationState.extracted_entities,
    fromDetection: detection.entities,
    merged: entities,
    preservedColor: entities.color,
    preservedSize: entities.size
  });

  const missingFields = detection.missingFields;
  const language: Language = detection.detectedLanguage === 'english' ? 'english' : 'arabic';

  logger.debug('Intent detected', {
    intent,
    stage,
    confidence: detection.confidence
  });

  // ==================== STEP 3: Search Products ====================
  let products: Product[] = [];

  // Determine if we need products
  const needsProducts = [
    'browse', 'product_query', 'price', 'availability', 'comparison', 'order'
  ].includes(intent);

  if (needsProducts) {
    const productId = getProductIdFromContext(messageText, conversationState, entities);
    const hasExplicitQuery = Boolean(entities.product_query || productId);

    console.log('🚨 DEBUG: needsProducts block entered', {
      intent,
      hasLastRecommended: !!conversationState.last_recommended_products?.[0],
      lastRecommendedId: conversationState.last_recommended_products?.[0],
      conversationStateKeys: Object.keys(conversationState)
    });
    logger.info('🚨 DEBUG: needsProducts block entered', {
      intent,
      hasLastRecommended: !!conversationState.last_recommended_products?.[0],
      lastRecommendedId: conversationState.last_recommended_products?.[0],
      conversationStateKeys: Object.keys(conversationState)
    });

    // ✅ CRITICAL FIX: For 'order' intent, FIRST try to get product from conversation history
    // This ensures we use the SAME product the user was discussing (with colors/sizes intact)
    if (intent === 'order' && conversationState.last_recommended_products?.[0]) {
      const lastRecommended = conversationState.last_recommended_products[0];
      console.log('🔍 Order intent detected - checking conversation history first', {
        lastRecommendedId: lastRecommended,
        hasProductQuery: !!entities.product_query
      });
      logger.info('🔍 Order intent detected - checking conversation history first', {
        lastRecommendedId: lastRecommended,
        hasProductQuery: !!entities.product_query
      });

      const product = await getProductById(merchantId, lastRecommended);
      console.log('📍 After getProductById', {
        productFound: !!product,
        productId: lastRecommended,
        productDetails: product ? {
          name: product.name,
          hasSizes: product.sizes?.length || 0,
          hasColors: product.colors?.length || 0
        } : null
      });

      if (product) {
        products = [product];
        console.log('✅ Retrieved product from conversation history for order', {
          productId: lastRecommended,
          productName: product.name,
          hasSizes: product.sizes?.length || 0,
          hasColors: product.colors?.length || 0,
          sizes: product.sizes,
          colors: product.colors
        });
        logger.info('✅ Retrieved product from conversation history for order', {
          productId: lastRecommended,
          productName: product.name,
          hasSizes: product.sizes?.length || 0,
          hasColors: product.colors?.length || 0,
          sizes: product.sizes,
          colors: product.colors
        });
      } else {
        console.log('❌ Product NOT found in database!', { productId: lastRecommended });
      }
    }

    // If no product found yet, proceed with normal search
    if (products.length === 0) {
      if (entities.wants_catalog || intent === 'browse') {
        // Show top products
        products = await getTopProducts(merchantId, 5);
      } else if (productId) {
        // Get specific product by ID
        const specific = await getProductById(merchantId, productId);
        if (specific) {
          products = [specific];
        }
      } else if (entities.product_query) {
        // Search by query
        products = await searchProducts(merchantId, entities.product_query, {}, 5);
      } else if (messageText.length > 5) {
        // Use message as search query
        products = await searchProducts(merchantId, messageText, {}, 3);
      }

      // Fallback to top products only when there is no explicit query
      if (products.length === 0 && intent !== 'greeting' && !hasExplicitQuery) {
        products = await getTopProducts(merchantId, 3);
      }
    }

    logger.debug('Products fetched', {
      count: products.length,
      query: entities.product_query || messageText.substring(0, 30),
      productNames: products.map(p => p.name)
    });
  }

  console.log('📦 Final products before planning', {
    intent,
    stage,
    productsCount: products.length,
    productNames: products.map(p => p.name),
    firstProductHasSizes: products[0] && Array.isArray(products[0].sizes) && products[0].sizes.length > 0,
    firstProductHasColors: products[0] && Array.isArray(products[0].colors) && products[0].colors.length > 0,
    firstProductSizes: products[0]?.sizes,
    firstProductColors: products[0]?.colors
  });
  logger.info('📦 Final products before planning', {
    intent,
    stage,
    productsCount: products.length,
    productNames: products.map(p => p.name),
    firstProductHasSizes: products[0] && Array.isArray(products[0].sizes) && products[0].sizes.length > 0,
    firstProductHasColors: products[0] && Array.isArray(products[0].colors) && products[0].colors.length > 0,
    firstProductSizes: products[0]?.sizes,
    firstProductColors: products[0]?.colors
  });

  // Resolve color entity against product options (compound = one option)
  if (products[0]?.colors?.length) {
    const colorResolution = resolveColorEntity(entities.color, products[0].colors, messageText);
    if (colorResolution.needsClarification) {
      entities.color = undefined;
    } else if (colorResolution.color) {
      entities.color = colorResolution.color;
    }
  }

  // ==================== STEP 4: Sales Planning ====================
  const plan: SalesPlan = planSalesAction({
    intent,
    stage,
    objection: detection.objection,
    entities,
    missingFields,
    conversationState,
    products,
    language
  });

  console.log('📋 Sales plan created', {
    nextAction: plan.nextAction,
    ctaType: plan.ctaType,
    oneQuestion: plan.oneQuestion,
    oneQuestionPreview: plan.oneQuestion?.substring(0, 100)
  });
  logger.debug('Sales plan created', {
    nextAction: plan.nextAction,
    ctaType: plan.ctaType
  });

  // ==================== STEP 5: Build Response ====================
  const response = await buildResponse({
    merchantId,
    storeName: merchantConfig.storeName,
    messageText,
    recentMessages: recentMessages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    })),
    intent,
    stage,
    plan,
    products,
    missingFields,
    language,
    persona: merchantConfig.persona,
    currency: merchantConfig.storeCurrency,
    wantsImage: entities.wants_image,
    wantsCatalog: entities.wants_catalog,
    wantsColorInfo: entities.wants_color_info,
    wantsSizeInfo: entities.wants_size_info,
    systemPrompt: merchantConfig.systemPrompt,
    policies: {
      shippingPolicy: merchantConfig.shippingPolicy,
      deliveryTime: merchantConfig.deliveryTime,
      paymentMethods: merchantConfig.paymentMethods,
      returnPolicy: merchantConfig.returnPolicy,
      additionalNotes: merchantConfig.additionalNotes
    }
  });

  if (response.usedAI) {
    aiCallsCount++;
  }

  // ==================== STEP 6: Update State ====================
  const updatedState = updateContext(conversationState, {
    currentMessage: messageText,
    intent,
    stage,
    entities,
    missingFields,
    productIds: products.map(p => p.id)
  });

  const processingTime = Date.now() - startTime;
  logger.info('Smart pipeline completed', {
    merchantId,
    intent,
    stage,
    productsCount: products.length,
    aiCallsCount,
    processingTimeMs: processingTime
  });

  return {
    replyText: response.replyText,
    intent,
    stage,
    entities,
    missingFields,
    products,
    plan,
    updatedState,
    aiCallsCount,
    language
  };
};

// Re-export for convenience
export { detectIntent } from './intent-detector.js';
export { buildContext, updateContext } from './context-manager.js';
