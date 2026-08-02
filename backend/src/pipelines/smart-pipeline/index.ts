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
import { resolveProductImageForBot } from '../../catalog/resolve-product-image.js';
import { planSalesAction, type SalesPlan } from '../../sales/sales-rules.js';
import { buildResponse } from '../../response/response-builder.js';
import { logger } from '../../utils/logger.js';
import { orchestrateWithAI, type AIConversationContext } from '../ai-orchestrator.js';
import { processWithSalesGPT } from '../../services/salesgpt/index.js';
import { sanitizeCaptionWhenImageSent } from '../../response/image-caption.js';

/**
 * Convert image URL to API endpoint for reliable Telegram delivery
 * ALWAYS use /api/products/:id/image endpoint regardless of storage method
 */
function convertImageUrlForBot(imageUrl: string | null, productId: string): string {
  if (!imageUrl || imageUrl === 'N/A') {
    return '';
  }
  // ALWAYS use /api/products/:id/image endpoint
  // This ensures Telegram can access images reliably (handles base64, HTTP URLs, /uploads/ paths)
  const baseUrl = process.env.BACKEND_URL || process.env.BASE_URL || 'https://xo-bot.com';

  // Add cache-busting parameter if imageUrl contains timestamp
  // This forces Telegram to reload the image when it's updated
  let cacheBuster = '';
  if (imageUrl && imageUrl.includes('product-image-')) {
    const match = imageUrl.match(/product-image-(\d+)-/);
    if (match && match[1]) {
      cacheBuster = `?v=${match[1]}`;
    }
  }

  return `${baseUrl}/api/products/${productId}/image${cacheBuster}`;
}

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

// ==================== SMART KEYWORD EXTRACTION ====================

/**
 * Extract potential product keywords from user message
 * Removes filler words and extracts nouns
 */
const extractProductKeywords = (messageText: string): string[] => {
  if (!messageText || messageText.trim().length === 0) {
    return [];
  }

  const text = messageText.trim().toLowerCase();

  // Stop words to remove (common Arabic/English filler words)
  const stopWords = [
    'بدي', 'ابي', 'اريد', 'ابغى', 'عاوز', 'اشتري', 'احجز', 'اطلب', 'اطلبو', 'اطلبها',
    'شو', 'ايش', 'كم', 'وين', 'متى', 'كيف', 'هل',
    'سعر', 'ثمن', 'تكلفة', 'قيمة',
    'عندكم', 'عندك', 'لديكم', 'معكم', 'موجود', 'متوفر',
    'السلام', 'عليكم', 'مرحبا', 'اهلا', 'هلا', 'صباح', 'مساء',
    'من', 'الى', 'في', 'على', 'عن', 'مع', 'هذا', 'هذه', 'ذلك',
    'نعم', 'اي', 'اه', 'طيب', 'تمام', 'ماشي',
    'لا', 'لأ', 'مو', 'ما', 'مش',  // كلمات النفي/الرفض
    'صورة', 'صور', 'صوره', 'فوتو', 'بكتشر', 'وريني', 'شوفيني', 'فرجيني', 'ارني', 'اعرض', 'اعرضلي',  // ✅ كلمات طلب الصورة
    'want', 'need', 'buy', 'purchase', 'order', 'get',
    'what', 'how', 'where', 'when', 'which',
    'price', 'cost', 'available', 'have', 'do', 'you',
    'the', 'a', 'an', 'is', 'are', 'was', 'were',
    'yes', 'no', 'ok', 'okay',
    'image', 'picture', 'photo', 'pic', 'show', 'see', 'let'  // ✅ English image request words
  ];

  // Color words to remove (we want the product name, not the color)
  const colorWords = [
    'احمر', 'ازرق', 'اخضر', 'اصفر', 'اسود', 'ابيض', 'بني', 'رمادي', 'برتقالي', 'وردي', 'بنفسجي',
    'حمرا', 'حمراء', 'زرقا', 'زرقاء', 'خضرا', 'خضراء', 'صفرا', 'صفراء', 'سودا', 'سوداء', 'بيضا', 'بيضاء',
    'red', 'blue', 'green', 'yellow', 'black', 'white', 'brown', 'gray', 'grey', 'orange', 'pink', 'purple'
  ];

  // Size words to remove
  const sizeWords = ['xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl', 'small', 'medium', 'large', 'صغير', 'متوسط', 'وسط', 'كبير', 'مقاس'];

  // Split into words and filter
  const words = text
    .replace(/[.,;:!?()]/g, ' ') // Remove punctuation
    .split(/\s+/)
    .filter(word => {
      // Remove short words (less than 2 chars)
      if (word.length < 2) return false;

      // Remove stop words
      if (stopWords.includes(word)) return false;

      // Remove color words
      if (colorWords.includes(word)) return false;

      // Remove size words
      if (sizeWords.includes(word)) return false;

      // Remove numbers
      if (/^\d+$/.test(word)) return false;

      return true;
    });

  // Extract potential multi-word product names
  const keywords: string[] = [];

  // Add individual words
  keywords.push(...words);

  // Try combining consecutive words (up to 3 words)
  for (let i = 0; i < words.length - 1; i++) {
    keywords.push(`${words[i]} ${words[i + 1]}`);

    if (i < words.length - 2) {
      keywords.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }
  }

  // Remove duplicates and return
  return [...new Set(keywords)].slice(0, 5); // Limit to top 5 keywords
};

// ==================== FULL AI MODE ====================

/**
 * Process message using FULL AI with strict guardrails
 * AI handles everything: intent, extraction, response, flow
 */
const processWithFullAI = async (
  input: SmartPipelineInput
): Promise<SmartPipelineResult> => {
  const {
    merchantId,
    messageText,
    recentMessages,
    conversationState,
    merchantConfig,
  } = input;

  const startTime = Date.now();

  // 🌐 Simple language detection helper
  const detectMessageLanguage = (text: string): Language => {
    const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
    const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
    return arabicChars >= englishChars ? 'arabic' : 'english';
  };

  // Determine language: use conversation state first, then detect from message
  const language: Language = conversationState.language || detectMessageLanguage(messageText);

  logger.info('🤖 Full AI mode started', {
    merchantId,
    messagePreview: messageText.substring(0, 50),
    language
  });

  // ==================== STEP 1: Smart Product Search ====================
  let products: Product[] = [];

  // 🚀 Strategy 0 (PRIORITY): Smart keyword extraction from current message FIRST!
  // This ensures we always search for what the user is asking NOW, not what they asked before
  const smartKeywords = extractProductKeywords(messageText);
  const meaningfulKeywords = smartKeywords.filter(k => k.length >= 3);

  if (meaningfulKeywords.length > 0) {
    // 🎯 Sort keywords by length (longest first = most specific)
    // "الساعة الروليكس" before "الروليكس" before "الساعة"
    const sortedKeywords = [...meaningfulKeywords].sort((a, b) => b.length - a.length);

    console.log('🧠 Priority: Smart keyword extraction from current message:', {
      messageText: messageText.substring(0, 50),
      keywords: sortedKeywords,
      strategy: 'longest-first (most specific)'
    });

    // Try searching with each keyword (most specific first)
    for (const keyword of sortedKeywords) {
      if (products.length === 0) {
        const searchResults = await searchProducts(
          merchantId,
          keyword,
          { inStockOnly: false },
          5
        );

        if (searchResults.length > 0) {
          products = searchResults;
          console.log('✅ Found products from current message:', {
            keyword,
            foundCount: products.length,
            topProduct: searchResults[0]?.name
          });
          break;
        }
      }
    }
  }

  // Strategy 1: Check if there's a last recommended product in conversation (FALLBACK)
  // Only use history if we didn't find anything from current message
  if (products.length === 0 && conversationState.last_recommended_products?.[0]) {
    const productId = conversationState.last_recommended_products[0];
    const product = await getProductById(merchantId, productId);
    if (product) {
      products = [product];
      console.log('📦 Fallback: Retrieved product from history:', {
        productId,
        productName: product.name,
        colors: product.colors,
        sizes: product.sizes,
        hasColors: !!(product.colors && product.colors.length > 0),
        hasSizes: !!(product.sizes && product.sizes.length > 0)
      });
    }
  }

  // Strategy 2: Search based on extracted product_query from conversation state
  if (conversationState.extracted_entities?.product_query && products.length === 0) {
    products = await searchProducts(
      merchantId,
      conversationState.extracted_entities.product_query,
      undefined,
      5
    );
    console.log('🔍 Searched products from conversation state:', {
      query: conversationState.extracted_entities.product_query,
      foundCount: products.length,
      firstProduct: products[0] ? {
        name: products[0].name,
        colors: products[0].colors,
        sizes: products[0].sizes,
        hasColors: !!(products[0].colors && products[0].colors.length > 0),
        hasSizes: !!(products[0].sizes && products[0].sizes.length > 0)
      } : null
    });
  }

  // Strategy 3 was moved to Strategy 0 (Priority search from current message)

  // Strategy 4: Fallback - Get top products if still nothing found
  // 🚨 CRITICAL: Don't use fallback for image requests! User is asking for a specific product image
  const isImageRequest = /(صورة|صور|وريني|شوفيني|فرجيني|image|picture|photo|show me)/i.test(messageText);

  if (products.length === 0 && !isImageRequest && (
    messageText.includes('شو') ||
    messageText.includes('ماذا') ||
    messageText.includes('what') ||
    messageText.includes('عندك') ||
    messageText.includes('متوفر')
  )) {
    products = await getTopProducts(merchantId, 5);
    console.log('🌟 Using top products as fallback:', {
      count: products.length
    });
  } else if (products.length === 0 && isImageRequest) {
    console.log('⚠️ Image request but no specific product found - will NOT use fallback');
  }

  // ==================== STEP 2: Call AI Orchestrator ====================
  const aiContext: AIConversationContext = {
    merchantId,
    storeName: merchantConfig.store_name || 'متجرنا',
    messageText,
    recentMessages,
    conversationState,
    products,
    merchantConfig,
    language  // Use the determined language from the start
  };

  let decision, validation, aiCallsCount;

  try {
    const result = await orchestrateWithAI(aiContext);
    decision = result.decision;
    validation = result.validation;
    aiCallsCount = result.aiCallsCount;
  } catch (error) {
    // If AI orchestration fails, log and create a fallback decision
    logger.error('AI Orchestration failed in Full AI Mode', error as Error, {
      merchantId,
      messageText: messageText.substring(0, 100)
    });

    console.error('❌ AI Orchestration error:', error);

    // Create a fallback decision to answer the question
    decision = {
      response_text: conversationState.language === 'arabic'
        ? 'عذراً، واجهنا مشكلة تقنية. كيف يمكنني مساعدتك؟'
        : 'Sorry, we encountered a technical issue. How can I help you?',
      next_action: 'answer_question' as any,
      collected_info: {},
      reasoning: 'AI orchestration failed - using fallback',
      validation: {
        all_steps_followed: false,
        no_information_invented: true,
        context_preserved: false,
        no_duplicate_questions: true
      },
      intent: 'other' as Intent,
      stage: 'discover' as Stage
    };

    validation = {
      valid: false,
      errors: ['AI orchestration failed'],
      warnings: [],
      shouldCorrect: false
    };

    aiCallsCount = 0;
  }

  // ==================== STEP 3: Update conversation state ====================
  const updatedState: ConversationState = {
    ...conversationState,
    last_intent: decision.intent,
    current_stage: decision.stage,
    extracted_entities: {
      ...(conversationState.extracted_entities || {}),
      ...decision.collected_info,
      product_query: decision.collected_info.product_name || conversationState.extracted_entities?.product_query,
      color: decision.collected_info.color,
      size: decision.collected_info.size,
      city: decision.collected_info.address, // City can be part of address
      quantity: decision.collected_info.quantity,
      // ✅ CRITICAL FIX: Preserve order information for Full AI Mode
      name: decision.collected_info.name || conversationState.extracted_entities?.name,
      phone: decision.collected_info.phone || conversationState.extracted_entities?.phone,
      address: decision.collected_info.address || conversationState.extracted_entities?.address
    },
    last_interaction: new Date().toISOString(),
    message_count: (conversationState.message_count || 0) + 1
  };

  // ✅ CRITICAL: ALWAYS save product to history if found
  // This ensures "بدي اطلبو" in the next message retrieves the correct product
  if (products.length > 0) {
    updatedState.last_recommended_products = [products[0].id];
    console.log('💾 Saved product to conversation history:', {
      productId: products[0].id,
      productName: products[0].name
    });
  }

  console.log('✅ AI decision applied:', {
    intent: decision.intent,
    stage: decision.stage,
    next_action: decision.next_action,
    collected_info: decision.collected_info,
    validation: validation.valid,
    validationErrors: validation.errors,
    validationWarnings: validation.warnings
  });

  const processingTime = Date.now() - startTime;
  logger.info('🤖 Full AI mode completed', {
    merchantId,
    intent: decision.intent,
    stage: decision.stage,
    next_action: decision.next_action,
    validationPassed: validation.valid,
    aiCallsCount,
    processingTimeMs: processingTime
  });

  // ==================== STEP 3.5: Handle Image Requests ====================
  let finalReplyText = decision.response_text;

  if (decision.next_action === 'send_image') {
    // ✅ VALIDATION: Check if we have a valid product match
    const requestedProductName = decision.collected_info.product_name?.toLowerCase() || '';
    let validProductFound = false;

    if (products.length === 1 && products[0].imageUrl) {
      // Check if product name matches the request (fuzzy match)
      const productName = products[0].name.toLowerCase();

      // Simple validation: check if product name contains keywords from request or vice versa
      if (requestedProductName) {
        const requestWords = requestedProductName.split(/\s+/).filter(w => w.length > 2);
        const productWords = productName.split(/\s+/).filter(w => w.length > 2);

        // Match if any significant word overlaps
        validProductFound = requestWords.some(rw => productName.includes(rw)) ||
          productWords.some(pw => requestedProductName.includes(pw));
      } else {
        // If AI didn't extract product name, trust the search result
        validProductFound = true;
      }

      if (validProductFound) {
        // Color-aware image for all channels (FB/IG/TG/WA parse [IMAGE: url])
        const requestedColor =
          decision.collected_info.color ||
          conversationState.extracted_entities?.color ||
          null;
        const resolved = await resolveProductImageForBot({
          merchantId,
          product: products[0],
          requestedColor,
          messageText
        });
        const imageUrlForBot =
          resolved.botImageUrl ||
          convertImageUrlForBot(products[0].imageUrl, products[0].id);

        const caption = sanitizeCaptionWhenImageSent(
          decision.response_text,
          language,
          products[0].name
        );
        // Add image tag to response
        finalReplyText = `${caption}\n\n[IMAGE: ${imageUrlForBot}]`;
        console.log('📸 Added image to Full AI response:', {
          requestedProduct: requestedProductName,
          foundProduct: products[0].name,
          requestedColor,
          strategy: resolved.strategy,
          originalImageUrl: products[0].imageUrl,
          convertedImageUrl: imageUrlForBot
        });
      } else {
        // Product mismatch - don't send wrong image!
        finalReplyText = language === 'arabic'
          ? `عذراً، ما لقيت "${requestedProductName}" بالضبط. ممكن تكتب اسم المنتج بشكل أوضح؟`
          : `Sorry, I couldn't find "${requestedProductName}" exactly. Can you write the product name more clearly?`;
        console.log('⚠️ Product name mismatch - not sending image:', {
          requested: requestedProductName,
          found: products[0].name
        });
      }
    } else if (products.length > 1) {
      // Multiple products - ask which one
      const productList = products.slice(0, 3).map(p => p.name).join('، ');
      finalReplyText = language === 'arabic'
        ? `في أكثر من منتج: ${productList}. شو المنتج اللي بدك صورته بالضبط؟`
        : `There are multiple products: ${productList}. Which one do you want to see exactly?`;
      console.log('⚠️ Multiple products for image request - asking for clarification');
    } else if (products.length === 0) {
      // No product found - be specific
      const requestedName = decision.collected_info.product_name || 'المنتج';
      finalReplyText = language === 'arabic'
        ? `عذراً، ما عندي منتج اسمه "${requestedName}" 😔 جرّب تكتب اسم منتج تاني أو اسأل "شو عندك؟"`
        : `Sorry, I don't have a product called "${requestedName}" 😔 Try another product name or ask "what do you have?"`;
      console.log('⚠️ No product found for image request:', { requestedName });
    } else if (!products[0].imageUrl) {
      // Product found but no image
      finalReplyText = language === 'arabic'
        ? `عذراً، ${products[0].name} ما في صورة إله حالياً 😔 بس ممكن أوصفلك إياه أو تطلبه مباشرة!`
        : `Sorry, ${products[0].name} doesn't have an image currently 😔 But I can describe it or you can order directly!`;
      console.log('⚠️ Product found but no image available');
    }
  }

  // ==================== STEP 4: Return result ====================
  return {
    replyText: finalReplyText,
    intent: decision.intent,
    stage: decision.stage,
    entities: {
      product_query: decision.collected_info.product_name,
      color: decision.collected_info.color,
      size: decision.collected_info.size,
      quantity: decision.collected_info.quantity,
      city: decision.collected_info.address,
      product_id: decision.collected_info.product_id
    },
    missingFields: [], // AI decides what's missing
    products,
    plan: {
      nextAction: decision.next_action === 'ask_color' || decision.next_action === 'ask_size'
        ? 'ask_clarify'
        : decision.next_action === 'confirm_order'
          ? 'confirm_order'
          : 'recommend_products',
      oneQuestion: decision.response_text,
      ctaType: decision.next_action === 'confirm_order' ? 'confirm' : 'choose',
      recommendationStrategy: 'match_query',
      shouldOfferDiscount: false,
      handoffReason: ''
    },
    updatedState,
    aiCallsCount,
    language,  // Use the determined language from the start
    next_action: decision.next_action  // ✅ Pass next_action for order detection
  };
};

// Re-export for convenience
export { detectIntent } from './intent-detector.js';
export { buildContext, updateContext } from './context-manager.js';
