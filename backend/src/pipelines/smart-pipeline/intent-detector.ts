/**
 * Smart Intent Detector - AI-powered intent detection
 * Uses OpenAI for complex message understanding
 */
import { extractName, extractPhone, extractAddress, extractDeliveryTime } from '../../orders/order-validator.js';
import { generateJSON, trackAICall, isAIAvailable } from '../../ai/gemini-client.js';
import { buildIntentDetectionPrompt } from '../../ai/prompt-builder.js';
import type {
  Intent,
  Stage,
  Objection,
  Entities,
  Message,
  ConversationState,
  DetectedLanguage
} from '../../core/types.js';
import { logger } from '../../utils/logger.js';
import { getMerchantProductKeywords } from '../../catalog/product-search.js';

// ==================== TYPES ====================

export interface IntentDetectionResult {
  intent: Intent;
  stage: Stage;
  objection: Objection;
  entities: Entities;
  missingFields: string[];
  confidence: number;
  detectedLanguage: DetectedLanguage;
}

export interface DetectIntentParams {
  messageText: string;
  recentMessages: Message[];
  conversationState: ConversationState;
  merchantId: string;
  platform?: string;
}

// ==================== VALIDATION ====================

const VALID_INTENTS: Intent[] = [
  'greeting', 'browse', 'product_query', 'price', 'availability',
  'shipping', 'comparison', 'order', 'complaint', 'other'
];

const VALID_STAGES: Stage[] = [
  'discover', 'offer', 'objection', 'close', 'handoff', 'clarify'
];

const VALID_OBJECTIONS: (Objection)[] = [
  'price', 'trust', 'shipping', 'quality', 'none', null
];

/**
 * Validate and normalize AI result
 */
const validateResult = (
  result: any,
  conversationState: ConversationState
): IntentDetectionResult => {
  // Validate intent
  let intent: Intent = 'other';
  if (VALID_INTENTS.includes(result.intent)) {
    intent = result.intent;
  }

  // Validate stage
  let stage: Stage = 'discover';
  if (VALID_STAGES.includes(result.stage)) {
    stage = result.stage;
  }

  // Validate objection
  let objection: Objection = null;
  if (VALID_OBJECTIONS.includes(result.objection)) {
    objection = result.objection;
  } else if (result.objection === 'none') {
    objection = 'none';
  }

  // Get product_id from context only when no explicit product_query
  let productId = result.entities?.product_id;
  const hasExplicitProductQuery = Boolean(result.entities?.product_query);
  if (!productId && !hasExplicitProductQuery && conversationState.last_recommended_products?.[0]) {
    productId = conversationState.last_recommended_products[0];
  }

  // Validate language
  let detectedLanguage: DetectedLanguage = 'arabic';
  if (['arabic', 'english', 'mixed'].includes(result.detectedLanguage)) {
    detectedLanguage = result.detectedLanguage;
  }

  // Ensure browse implies wants_catalog
  const wantsCatalog = intent === 'browse' || result.entities?.wants_catalog === true;

  return {
    intent,
    stage,
    objection,
    entities: {
      product_query: result.entities?.product_query || undefined,
      product_id: productId,
      city: result.entities?.city || undefined,
      budget: result.entities?.budget || undefined,
      size: result.entities?.size || undefined,
      color: result.entities?.color || undefined,
      quantity: typeof result.entities?.quantity === 'number' ? result.entities.quantity : undefined,
      wants_image: result.entities?.wants_image === true || undefined,
      wants_catalog: wantsCatalog || undefined
    },
    missingFields: Array.isArray(result.missing_fields) ? result.missing_fields : [],
    confidence: typeof result.confidence === 'number'
      ? Math.max(0, Math.min(1, result.confidence))
      : 0.5,
    detectedLanguage
  };
};

// ==================== FALLBACK DETECTION ====================

/**
 * Simple rule-based fallback when AI is unavailable
 */
/**
 * ===================================================================
 * COMPLETE FIX - Intent Detector Enhanced
 * ===================================================================
 * 
 * المشاكل المحلولة:
 * 1. Rule-based detection ضعيف جداً
 * 2. لا يكشف price intent
 * 3. لا يستخرج المنتج من الرسالة
 * 4. Fallback سيء
 */

// ==================== ENHANCED FALLBACK DETECTION ====================

/**
 * ✅ FIX: Rule-based detection محسّن وشامل
 */
const fallbackDetection = (
  messageText: string,
  conversationState: ConversationState
): IntentDetectionResult => {
  const text = messageText.toLowerCase().trim();
  const arabicPattern = /[\u0600-\u06FF]/;
  const detectedLanguage: DetectedLanguage = arabicPattern.test(text) ? 'arabic' : 'english';

  // ==================== 0. ORDER CONFIRMATION (HIGHEST PRIORITY!) ====================
  // ✅ NEW: Handle confirmations like "اي بس", "نعم وحدة", "تمام بس ١"
  if (conversationState.last_intent === 'order') {
    const confirmPatterns = [
      /^(نعم|أي|اي|تمام|موافق|أكيد|بالتأكيد|ماشي|طيب|اوكي|ok|okay|yes|sure)(\s+(بس|فقط|وحدة|واحدة|١|1))?\s*[\d١-٩]*[\s!،,.؟?]*$/i,
      /^(لك|ايه)\s+(بس|فقط|اي|نعم|تمام)(\s+(وحدة|واحدة|١|1))?/i,
      /^(بس|فقط)\s+(نعم|اي|تمام|وحدة|واحدة|١|1)/i
    ];
    
    if (confirmPatterns.some(p => p.test(text))) {
      console.log('✅ Confirmation detected:', text);
      return {
        intent: 'order',
        stage: 'close',
        objection: null,
        entities: {},
        missingFields: [],
        confidence: 0.95,
        detectedLanguage
      };
    }
  }

  // ==================== 1. GREETING ====================
  const greetingPatterns = [
    /^(السلام عليكم|مرحبا|أهلا|سلام|هلا|صباح|مساء|وعليكم السلام)[\s!،,]*$/i,
    /^(hello|hi|hey|good morning|good evening)[\s!,]*$/i
  ];
  
  if (greetingPatterns.some(p => p.test(text))) {
    return {
      intent: 'greeting',
      stage: 'discover',
      objection: null,
      entities: {},
      missingFields: [],
      confidence: 0.9,
      detectedLanguage
    };
  }

  // ==================== 2. PRICE INTENT (CRITICAL FIX!) ====================
  const pricePatterns = [
    /\b(شو|كم|ايش|وش|ما هو|بكم|قداش)\s+(سعر|ثمن|تكلفة|كلفة)/i,
    /\b(سعر|ثمن|كلفة)\s+(ال)?([أ-ي]+)/i,  // "سعر القميص"
    /\b(بكم|بكام|بقداش)\s+([أ-ي]+)/i,      // "بكم القميص"
    /\b(price|cost|how much)\b/i
  ];

  for (const pattern of pricePatterns) {
    const match = text.match(pattern);
    if (match) {
      // Extract product name
      const productQuery = extractProductFromMessage(messageText);
      
      return {
        intent: 'price',
        stage: 'offer',
        objection: null,
        entities: {
          product_query: productQuery
        },
        missingFields: [],
        confidence: 0.85,
        detectedLanguage
      };
    }
  }

  // ==================== 3. COLOR/SIZE INQUIRY (NEW!) ====================
  // Pattern: "شوفي الألوان من X" or "ما هي المقاسات لـ X" or "شوفي الوان منها"
  const colorSizePatterns = [
    /\b(شو|شوفي|ايش|وش|ما هي|وريني|فرجيني|عرضي|أرني)\s+(الألوان|الوان|ألوان|المقاسات|مقاسات|sizes|colors)/i,
    /\b(الألوان|الوان|ألوان|المقاسات|مقاسات|colors|sizes)\s+(المتوفرة|المتوفر|المتاحة|المتاح|available)/i,
    /\b(في|عندك|عندكم)\s+(الألوان|الوان|ألوان|المقاسات|مقاسات|colors|sizes)/i
  ];

  for (const pattern of colorSizePatterns) {
    const match = text.match(pattern);
    if (match) {
      const asksAboutColor = /الألوان|الوان|ألوان|colors/i.test(match[0]);
      const asksAboutSize = /المقاسات|مقاسات|sizes/i.test(match[0]);
      
      // Check if user refers to a previous product (منها، منه، من هذا)
      const refersToContext = /\b(منها|منه|منو|من هذا|من هذه|منهم|of it|from it)\b/i.test(text);
      
      // Extract product name from message or rely on context
      let productQuery: string | undefined;
      if (!refersToContext) {
        // Try to extract product name from the rest of the message
        const restOfMessage = messageText.replace(match[0], '').trim();
        productQuery = extractProductFromMessage(restOfMessage);
      }
      
      return {
        intent: 'availability',
        stage: 'offer',
        objection: null,
        entities: {
          product_query: productQuery,  // Will be undefined if referring to context
          wants_color_info: asksAboutColor || undefined,
          wants_size_info: asksAboutSize || undefined
        },
        missingFields: [],
        confidence: 0.95,
        detectedLanguage
      };
    }
  }

  // ==================== 4. BROWSE / CATALOG ====================
  const browsePatterns = [
    /\b(شو|ايش|وش|ما هي)\s+(عندك|عندكم|لديك|لديكم|في|موجود)/i,
    /\b(بدي|ابي|عاوز|اريد|حابب)\s+(اشوف|شوف|أشوف|ارى)/i,
    /\b(ورجيني|فرجيني|أرني|اعرض|عرض)/i,
    /\b(المنتجات|منتجات|البضاعة|المتوفر|الكتالوج|catalog|products|what do you have)/i
  ];

  if (browsePatterns.some(p => p.test(text))) {
    return {
      intent: 'browse',
      stage: 'discover',
      objection: null,
      entities: {
        wants_catalog: true
      },
      missingFields: [],
      confidence: 0.85,
      detectedLanguage
    };
  }

  // ==================== 5. PRODUCT QUERY ====================
  const productQueryPatterns = [
    /\b(في عندك|في عندكم|عندك|عندكم|موجود)\s+([أ-ي\s]{2,})/i,
    /\b(بدي|ابي|عاوز|اريد|ابحث عن|looking for|want|need)\s+([أ-ي\s]{2,})/i,
    /\b(فيه|في|هل يوجد|do you have)\s+([أ-ي\s]{2,})/i
  ];

  for (const pattern of productQueryPatterns) {
    const match = text.match(pattern);
    if (match) {
      const productQuery = match[2]?.trim() || extractProductFromMessage(messageText);
      
      if (productQuery && productQuery.length > 1) {
        return {
          intent: 'product_query',
          stage: 'discover',
          objection: null,
          entities: {
            product_query: productQuery
          },
          missingFields: [],
          confidence: 0.8,
          detectedLanguage
        };
      }
    }
  }

  // ==================== 6. AVAILABILITY ====================
  const availabilityPatterns = [
    /\b(متوفر|موجود|في مخزون|available|in stock)\b/i,
    /\b(متى يتوفر|متى يوصل|when available)\b/i
  ];

  if (availabilityPatterns.some(p => p.test(text))) {
    const productQuery = extractProductFromMessage(messageText);
    return {
      intent: 'availability',
      stage: 'offer',
      objection: null,
      entities: {
        product_query: productQuery
      },
      missingFields: [],
      confidence: 0.75,
      detectedLanguage
    };
  }

  // ==================== 7. IMAGE REQUEST (ENHANCED!) ====================
  // ✅ FIXED: Removed \b to catch "في صورة", "فيه صورة", etc.
  const imagePatterns = [
    /(صورة|صور|صوره|تصوير|فوتو|بكتشر|photo|picture|image|pic)/i,  // ← Fixed: no \b
    /(وريني|شوفيني|فرجيني|اعرضلي|أرني|عرضلي|أرجيني|شوف|اعرض|فرجي)/i,
    /(show me|let me see|can i see|wanna see)/i
  ];

  if (imagePatterns.some(p => p.test(text))) {
    const productQuery = extractProductFromMessage(messageText);
    return {
      intent: 'product_query',
      stage: 'offer',
      objection: null,
      entities: {
        product_query: productQuery,
        wants_image: true
      },
      missingFields: [],
      confidence: 0.85,
      detectedLanguage
    };
  }

  // ==================== 8. ORDER ====================
  const orderPatterns = [
    /\b(بدي|ابي|عاوز|اريد|حابب)\s+(اطلب|أطلب|طلب|اشتري|order|buy)/i,
    /\b(احجز|حجز|reserve)\b/i
  ];

  if (orderPatterns.some(p => p.test(text))) {
    // Check if has name/phone/address
    const hasName = /\b(اسمي|اسم|name)\s+([أ-يa-zA-Z\s]{3,})/i.test(text);
    const hasPhone = /(\d{7,15}|[٠-٩]{7,15})/i.test(text);
    const hasAddress = /\b(عنوان|address|مكان|مدينة)\b/i.test(text);

    const missingFields: string[] = [];
    if (!hasName) missingFields.push('الاسم الكامل');
    if (!hasPhone) missingFields.push('رقم الهاتف');
    if (!hasAddress) missingFields.push('العنوان بالتفصيل');

    return {
      intent: 'order',
      stage: missingFields.length > 0 ? 'clarify' : 'close',
      objection: null,
      entities: {
        product_query: extractProductFromMessage(messageText)
      },
      missingFields,
      confidence: 0.8,
      detectedLanguage
    };
  }

  // ==================== 9. COMPLAINT ====================
  const complaintPatterns = [
    /\b(شكوى|مشكلة|سيء|زفت|خراب|غلط|complaint|problem|bad|terrible)\b/i
  ];

  if (complaintPatterns.some(p => p.test(text))) {
    return {
      intent: 'complaint',
      stage: 'handoff',
      objection: null,
      entities: {},
      missingFields: [],
      confidence: 0.85,
      detectedLanguage
    };
  }

  // ==================== 10. SHIPPING ====================
  const shippingPatterns = [
    /\b(توصيل|شحن|delivery|shipping)\b/i,
    /\b(متى يوصل|كم التوصيل|how long|when deliver)\b/i
  ];

  if (shippingPatterns.some(p => p.test(text))) {
    return {
      intent: 'shipping',
      stage: 'offer',
      objection: null,
      entities: {},
      missingFields: [],
      confidence: 0.75,
      detectedLanguage
    };
  }

  // ==================== 11. OBJECTIONS ====================
  // Price objection
  if (/\b(غالي|مكلف|باهظ|expensive|costly|too much)\b/i.test(text)) {
    return {
      intent: 'price',
      stage: 'objection',
      objection: 'price',
      entities: {},
      missingFields: [],
      confidence: 0.8,
      detectedLanguage
    };
  }

  // Quality objection
  if (/\b(جودة|رديء|سيء|quality|bad|poor)\b/i.test(text)) {
    return {
      intent: 'product_query',
      stage: 'objection',
      objection: 'quality',
      entities: {},
      missingFields: [],
      confidence: 0.75,
      detectedLanguage
    };
  }

  // ==================== 12. DEFAULT ====================
  // Try to extract product even in "other" intent
  const productQuery = extractProductFromMessage(messageText);
  
  if (productQuery && productQuery.length > 2) {
    return {
      intent: 'product_query',
      stage: 'discover',
      objection: null,
      entities: {
        product_query: productQuery
      },
      missingFields: [],
      confidence: 0.5,
      detectedLanguage
    };
  }

  return {
    intent: 'other',
    stage: 'discover',
    objection: null,
    entities: {},
    missingFields: [],
    confidence: 0.3,
    detectedLanguage
  };
};

/**
 * ✅ استخراج اسم المنتج من الرسالة
 */
function extractProductFromMessage(messageText: string): string | undefined {
  const text = messageText.trim();
  
  // Remove common words
  const stopWords = [
    'شو', 'كم', 'ايش', 'وش', 'ما', 'هو', 'سعر', 'ثمن', 'كلفة',
    'بكم', 'عندك', 'عندكم', 'في', 'بدي', 'ابي', 'عاوز', 'اريد',
    'حابب', 'اطلب', 'أطلب', 'ال', 'من', 'إلى', 'على', 'في'
  ];
  
  // Extract words
  const words = text
    .split(/\s+/)
    .map(w => w.replace(/[،؟!.?!,]/g, '').trim())
    .filter(w => w.length > 1)
    .filter(w => !stopWords.includes(w.toLowerCase()));
  
  // If only one word left, it's probably the product
  if (words.length === 1) {
    return words[0];
  }
  
  // Try to find product names (Arabic nouns)
  const arabicNouns = words.filter(w => /^[أ-ي]+$/.test(w) && w.length >= 3);
  if (arabicNouns.length > 0) {
    return arabicNouns.join(' ');
  }
  
  // Return first meaningful word
  if (words.length > 0) {
    return words[0];
  }
  
  return undefined;
}

// ==================== TYPO CORRECTION ====================

/**
 * ✅ Correct common Arabic typos and spelling errors
 */
const correctCommonTypos = (text: string): string => {
  const typoMap: Record<string, string> = {
    // Common Arabic typos
    'السلاك': 'السلام',
    'سلاك': 'سلام',
    'سعار': 'سعر',
    'شوا': 'شو',
    'شوو': 'شو',
    'بدو': 'بدي',
    'بدى': 'بدي',
    'ابى': 'ابي',
    'ابو': 'ابي',
    'اريدو': 'اريد',
    'اريدي': 'اريد',
    'كنزا': 'كنزة',
    'كنزه': 'كنزة',
    'قميسا': 'قميص',
    'ساعه': 'ساعة',
    'موجوده': 'موجودة',
    'متوفره': 'متوفرة',
    'الوانو': 'الوان',
    'الوانه': 'الوان',
    'مقاساتو': 'مقاسات',
    'مقاساته': 'مقاسات',
    // Common English typos
    'wat': 'what',
    'wht': 'what',
    'hw': 'how',
    'pric': 'price',
    'colr': 'color',
    'siz': 'size'
  };
  
  let corrected = text;
  
  // Apply corrections
  for (const [typo, correct] of Object.entries(typoMap)) {
    const regex = new RegExp(`\\b${typo}\\b`, 'gi');
    if (regex.test(corrected)) {
      corrected = corrected.replace(regex, correct);
      console.log(`🔧 Typo corrected: "${typo}" → "${correct}"`);
    }
  }
  
  return corrected;
};

// ==================== UPDATE THE MAIN detectIntent FUNCTION ====================

/**
 * ✅ Enhanced intent detection with better fallback
 */
export const detectIntent = async (
  params: DetectIntentParams
): Promise<IntentDetectionResult> => {
  let {
    messageText,
    recentMessages,
    conversationState,
    merchantId,
    platform
  } = params;

  // ✅ NEW: Correct common typos before processing
  const originalText = messageText;
  messageText = correctCommonTypos(messageText);
  if (messageText !== originalText) {
    logger.info('Typo correction applied', {
      original: originalText,
      corrected: messageText
    });
  }

  // ✅ ALWAYS try rule-based first for common intents
  const quickCheck = quickIntentCheck(messageText, conversationState);
  if (quickCheck.confidence >= 0.8) {
    logger.info('Intent detected via rules (high confidence)', {
      intent: quickCheck.intent,
      confidence: quickCheck.confidence
    });
    return quickCheck;
  }

  // Check AI availability
  if (!isAIAvailable()) {
    logger.warn('AI unavailable, using enhanced rule-based detection');
    return fallbackDetection(messageText, conversationState);
  }

  try {
    // Get merchant product keywords for hints
    let merchantKeywords: string[] = [];
    try {
      merchantKeywords = await getMerchantProductKeywords(merchantId);
    } catch (err) {
      logger.warn('Could not fetch merchant keywords', { merchantId });
    }

    // Build context
    const historyContext = recentMessages
      .slice(-20)
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n');

    const stateContext = conversationState.last_intent
      ? `Previous intent: ${conversationState.last_intent}\n`
      : '';

    const productContext = conversationState.last_recommended_products?.[0]
      ? `Last recommended product ID: ${conversationState.last_recommended_products[0]}\n`
      : '';

    // Build user prompt with CRITICAL improvements
    const userPrompt = `Current message: "${messageText}"
${historyContext ? `\n**Conversation history:**\n${historyContext}\n` : ''}
${stateContext}${productContext}
${platform ? `Platform: ${platform}\n` : ''}
${merchantKeywords.length > 0 ? `Product keywords (hints): ${merchantKeywords.slice(0, 30).join(', ')}\n` : ''}

**CRITICAL INTENT DETECTION RULES:**
1. "شو سعر X" → intent: "price", entities: {product_query: "X"}
2. "شو عندك" / "ماذا لديك" → intent: "browse", entities: {wants_catalog: true}
3. "بدي X" / "ابي X" / "اريد X" / "عاوز X" + (product name) → intent: "product_query", entities: {product_query: "X"}
4. "بدي أطلب" / "اريد اطلب" → intent: "order"
5. "شوفي الألوان" or "شوفي الوان منها" → intent: "availability", entities: {wants_color_info: true, product_query: null if referring to previous product}
6. "شوفي المقاسات" → intent: "availability", entities: {wants_size_info: true}
7. "السلام عليكم" / "مرحبا" / "أهلا" (ONLY without product name) → intent: "greeting"

**CRITICAL:** 
- "بدي" + product name = "product_query", NOT "greeting" or "order"!
- "بدي أطلب" / "احجز" / "اشتري" = "order"
- Greeting must be STANDALONE, not followed by product request

**CRITICAL FOR MISSING_FIELDS:**
- For order intent, analyze ENTIRE history for: name, phone, address (with street/area), delivery time
- Only include in missing_fields if NEVER mentioned in history
- Address must include neighborhood/street, not just city
- DO NOT extract action verbs like "بدي", "اريد", "اطلب" as names!

Extract intent and entities. Return ONLY valid JSON.`;

    const systemPrompt = buildIntentDetectionPrompt();

    trackAICall();

    const result = await generateJSON<any>(`${systemPrompt}\n\n${userPrompt}`, {
      temperature: 0.1
    });

    // Logging للتشخيص
    console.log('[IntentDetector] AI Response:', {
      success: result.success,
      intent: result.data?.intent,
      entities: result.data?.entities,
      confidence: result.data?.confidence
    });

    if (!result.success || !result.data) {
      logger.error('Intent detection failed, using enhanced fallback');
      console.log('[IntentDetector] Falling back to rule-based detection');
      return fallbackDetection(messageText, conversationState);
    }

    const validated = validateResult(result.data, conversationState);

    // ✅ Force image intent flag if user asked for image
    if (/(صورة|صور|تصوير|photo|picture|image|pic)/i.test(messageText)) {
      validated.entities = {
        ...validated.entities,
        wants_image: true
      };
    }

    // ==================== 🚀 PROACTIVE COLOR/SIZE EXTRACTION ====================
    // استخراج اللون والمقاس بشكل استباقي من أي رسالة (حتى لو لم يسأل البوت)
    
    const extractColorAndSizeProactive = (text: string): { color?: string; size?: string } => {
      const textLower = text.toLowerCase().trim();
      
      // قائمة الألوان الشائعة مع تنويعات (عربي وإنجليزي)
      const colorPatterns = [
        { pattern: /(أحمر|احمر|حمرا|حمراء|حمره)/i, color: 'احمر' },
        { pattern: /(أزرق|ازرق|زرقا|زرقاء|زرقه)/i, color: 'ازرق' },
        { pattern: /(أخضر|اخضر|خضرا|خضراء|خضره)/i, color: 'اخضر' },
        { pattern: /(أصفر|اصفر|صفرا|صفراء|صفره)/i, color: 'اصفر' },
        { pattern: /(أسود|اسود|سودا|سوداء|سوده)/i, color: 'اسود' },
        { pattern: /(أبيض|ابيض|بيضا|بيضاء|بيضه)/i, color: 'ابيض' },
        { pattern: /(بني|بنيه)/i, color: 'بني' },
        { pattern: /(رمادي|رماديه)/i, color: 'رمادي' },
        { pattern: /(برتقالي|برتقاليه)/i, color: 'برتقالي' },
        { pattern: /(وردي|ورديه|زهري|زهريه|روز)/i, color: 'وردي' },
        { pattern: /(بنفسجي|بنفسجيه|موف)/i, color: 'بنفسجي' },
        { pattern: /\b(red)\b/i, color: 'احمر' },
        { pattern: /\b(blue)\b/i, color: 'ازرق' },
        { pattern: /\b(green)\b/i, color: 'اخضر' },
        { pattern: /\b(yellow)\b/i, color: 'اصفر' },
        { pattern: /\b(black)\b/i, color: 'اسود' },
        { pattern: /\b(white)\b/i, color: 'ابيض' },
        { pattern: /\b(brown)\b/i, color: 'بني' },
        { pattern: /\b(gray|grey)\b/i, color: 'رمادي' },
        { pattern: /\b(orange)\b/i, color: 'برتقالي' },
        { pattern: /\b(pink)\b/i, color: 'وردي' },
        { pattern: /\b(purple|violet)\b/i, color: 'بنفسجي' }
      ];
      
      // قائمة المقاسات
      const sizePatterns = [
        { pattern: /\b(xs|x-small)\b/i, size: 'xs' },
        { pattern: /\b(s|small|صغير)\b/i, size: 's' },
        { pattern: /\b(m|medium|متوسط|وسط)\b/i, size: 'm' },
        { pattern: /\b(l|large|كبير)\b/i, size: 'l' },
        { pattern: /\b(xl|x-large)\b/i, size: 'xl' },
        { pattern: /\b(xxl|xx-large|2xl)\b/i, size: 'xxl' },
        { pattern: /\b(xxxl|3xl)\b/i, size: 'xxxl' }
      ];
      
      let detectedColor: string | undefined;
      let detectedSize: string | undefined;
      
      // البحث عن اللون
      for (const { pattern, color } of colorPatterns) {
        if (pattern.test(text)) {
          detectedColor = color;
          break;
        }
      }
      
      // البحث عن المقاس
      for (const { pattern, size } of sizePatterns) {
        if (pattern.test(text)) {
          detectedSize = size;
          break;
        }
      }
      
      return { color: detectedColor, size: detectedSize };
    };
    
    // ✅ استخراج استباقي من الرسالة الحالية
    const { color: proactiveColor, size: proactiveSize } = extractColorAndSizeProactive(messageText);
    
    if (proactiveColor) {
      validated.entities = {
        ...validated.entities,
        color: proactiveColor
      };
      console.log('🎨✨ Proactive color extraction:', { color: proactiveColor, from: messageText });
    }
    
    if (proactiveSize) {
      validated.entities = {
        ...validated.entities,
        size: proactiveSize
      };
      console.log('📏✨ Proactive size extraction:', { size: proactiveSize, from: messageText });
    }

    // ✅ CONTEXT-AWARE: Extract color/size if bot asked about them
    // (هذا للحالات التي يجيب فيها المستخدم على سؤال البوت)
    const botMessages = (recentMessages || []).filter(m => m.role === 'assistant');
    const lastBotMessage = botMessages.length > 0 ? botMessages[botMessages.length - 1]?.content || '' : '';
    
    const botAskedAboutColor = lastBotMessage.includes('اللون') || lastBotMessage.includes('color') || lastBotMessage.includes('🎨');
    const botAskedAboutSize = lastBotMessage.includes('المقاس') || lastBotMessage.includes('size') || lastBotMessage.includes('📏');
    
    const textLower = messageText.toLowerCase().trim();
    
    // Legacy color patterns (for context-aware extraction)
    const colorPatterns = [
      'أحمر', 'احمر', 'أزرق', 'ازرق', 'أخضر', 'اخضر', 'أصفر', 'اصفر', 'أسود', 'اسود',
      'أبيض', 'ابيض', 'بني', 'رمادي', 'برتقالي', 'وردي', 'بنفسجي', 'زهري',
      'red', 'blue', 'green', 'yellow', 'black', 'white', 'brown', 'gray', 'grey',
      'orange', 'pink', 'purple', 'violet'
    ];
    
    // Legacy size patterns (for context-aware extraction)
    const sizePatterns = ['s', 'm', 'l', 'xl', 'xxl', 'small', 'medium', 'large', 'صغير', 'متوسط', 'كبير', 'جداً'];
    
    // If bot asked about color and message contains a color (and not already extracted)
    if (botAskedAboutColor && !validated.entities.color && colorPatterns.some(color => textLower.includes(color.toLowerCase()))) {
      const detectedColor = colorPatterns.find(color => textLower.includes(color.toLowerCase()));
      console.log('🎨 Detected color from context', { color: detectedColor, messageText });
      validated.entities = {
        ...validated.entities,
        color: detectedColor
      };
      // Keep the order intent if it was order before
      if (validated.intent === 'product_query' || validated.intent === 'other') {
        validated.intent = 'order';
      }
    }
    
    // If bot asked about size and message contains a size (and not already extracted)
    if (botAskedAboutSize && !validated.entities.size && sizePatterns.some(size => textLower.includes(size.toLowerCase()))) {
      const detectedSize = sizePatterns.find(size => textLower.includes(size.toLowerCase()));
      console.log('📏 Detected size from context', { size: detectedSize, messageText });
      validated.entities = {
        ...validated.entities,
        size: detectedSize
      };
      // Keep the order intent if it was order before
      if (validated.intent === 'product_query' || validated.intent === 'other') {
        validated.intent = 'order';
      }
    }

    const name = extractName(messageText, recentMessages || []);
    const phone = extractPhone(messageText, recentMessages || []);
    const address = extractAddress(messageText, recentMessages || []);
    const time = extractDeliveryTime(messageText, recentMessages || []);

    const hasOrderInfo = Boolean(name || phone || address || time);

    if (hasOrderInfo && (validated.intent === 'other' || validated.intent === 'greeting')) {
      const labels = validated.detectedLanguage === 'english'
        ? { name: 'Full Name', phone: 'Phone Number', address: 'Detailed Address' }
        : { name: 'الاسم الكامل', phone: 'رقم الهاتف', address: 'العنوان بالتفصيل' };

      const missingFields: string[] = [];
      if (!name) missingFields.push(labels.name);
      if (!phone) missingFields.push(labels.phone);
      if (!address) missingFields.push(labels.address);
      // delivery time is optional

      validated.intent = 'order';
      validated.stage = 'close';
      validated.missingFields = missingFields;
      validated.confidence = Math.max(validated.confidence, 0.8);
    }

    if (validated.intent === 'order') {
      const labels = validated.detectedLanguage === 'english'
        ? { name: 'Full Name', phone: 'Phone Number', address: 'Detailed Address' }
        : { name: 'الاسم الكامل', phone: 'رقم الهاتف', address: 'العنوان بالتفصيل' };

      const missingFields: string[] = [];
      if (!name) missingFields.push(labels.name);
      if (!phone) missingFields.push(labels.phone);
      if (!address) missingFields.push(labels.address);
      // delivery time is optional

      validated.missingFields = missingFields;
      validated.stage = missingFields.length > 0 ? 'clarify' : 'close';
      validated.confidence = Math.max(validated.confidence, 0.8);
    }

    // Force handoff for complaints
    if (validated.intent === 'complaint') {
      validated.stage = 'handoff';
    }

    logger.info('Intent detected via AI', {
      intent: validated.intent,
      stage: validated.stage,
      confidence: validated.confidence,
      merchantId
    });

    return validated;

  } catch (error) {
    logger.error('Intent detection error, using fallback', error as Error);
    return fallbackDetection(messageText, conversationState);
  }
};

/**
 * ✅ Quick intent check for common patterns (no AI needed)
 */
function quickIntentCheck(
  messageText: string,
  conversationState: ConversationState
): IntentDetectionResult {
  return fallbackDetection(messageText, conversationState);
}
