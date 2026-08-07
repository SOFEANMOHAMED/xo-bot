/**
 * Response Builder - Build final bot responses
 * Combines AI-generated text with deterministic product formatting
 */

import type { Language, Product, Intent, Stage } from '../core/types.js';
import type { AIPermissions } from '../ai/ai-permissions.js';
import type { SalesPlan } from '../sales/sales-rules.js';
import { formatProducts } from '../catalog/product-formatter.js';
import { resolveProductImageForBot } from '../catalog/resolve-product-image.js';
import { sanitizeCaptionWhenImageSent } from './image-caption.js';
import { guardReply } from './guard.js';
import { generateContent, trackAICall, type ChatMessage } from '../ai/gemini-client.js';
import { buildSalesPrompt, type PromptContext } from '../ai/prompt-builder.js';
import { extractName, extractPhone, extractAddress } from '../orders/order-validator.js';
import { buildOrderData, generateOrderDataTag } from '../orders/order-builder.js';
import { logger } from '../utils/logger.js';

/**
 * Convert image URL to API endpoint for reliable bot delivery
 * Includes cache-busting to force Telegram to reload updated images
 */
function convertImageUrlForBot(imageUrl: string | null, productId: string): string {
  if (!imageUrl || imageUrl === 'N/A') return '';
  const baseUrl = process.env.BACKEND_URL || process.env.BASE_URL || 'https://xo-bot.com';
  
  // Add cache-busting parameter from image filename timestamp
  let cacheBuster = '';
  if (imageUrl && imageUrl.includes('product-image-')) {
    const match = imageUrl.match(/product-image-(\d+)-/);
    if (match && match[1]) {
      cacheBuster = `?v=${match[1]}`;
    }
  }
  
  return `${baseUrl}/api/products/${productId}/image${cacheBuster}`;
}

// Templates
import * as arMessages from './templates/ar/messages.js';
import * as enMessages from './templates/en/messages.js';

// ==================== TYPES ====================

export interface ResponseBuilderInput {
  merchantId: string;
  storeName: string;
  messageText: string;
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
  intent: Intent;
  stage: Stage;
  plan: SalesPlan;
  products: Product[];
  missingFields: string[];
  language: Language;
  persona: 'formal' | 'friendly' | 'sales' | 'fast' | 'luxury';
  currency: string;
  wantsImage?: boolean;
  wantsCatalog?: boolean;
  wantsColorInfo?: boolean;
  wantsSizeInfo?: boolean;
  useAI?: boolean;
  systemPrompt?: string;
  policies?: {
    shippingPolicy?: string;
    deliveryTime?: string;
    paymentMethods?: string;
    returnPolicy?: string;
    additionalNotes?: string;
  };
  permissions?: AIPermissions;
}

export interface ResponseBuilderResult {
  replyText: string;
  usedAI: boolean;
  guardPassed: boolean;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Get templates for language
 */
const getTemplates = (language: Language) => {
  return language === 'arabic' ? arMessages : enMessages;
};

/**
 * Check if response should skip AI
 */
const shouldSkipAI = (
  intent: Intent,
  plan: SalesPlan,
  wantsCatalog: boolean,
  missingFields: string[],
  products: Product[],
  wantsColorInfo?: boolean,
  wantsSizeInfo?: boolean
): boolean => {
  
  // ✅ FIXED: DON'T skip AI for order flow - let AI be enthusiastic!
  // Removed: if (intent === 'order' && missingFields.length > 0) return true;
  
  // Catalog request - deterministic product list
  if (wantsCatalog) {
    return true;
  }

  // Explicit product query with no results - deterministic not found
  if (products.length === 0 && ['product_query', 'price', 'availability', 'order'].includes(intent)) {
    return true;
  }
  
  // Order confirmed - deterministic thank you
  if (plan.nextAction === 'confirm_order' && missingFields.length === 0) {
    return true;
  }
  // Price intent - deterministic (price shown in product format)
if (intent === 'price') {
  return true;
}

  // Availability intent asking about colors/sizes - deterministic
  if (intent === 'availability' && (wantsColorInfo || wantsSizeInfo) && products.length > 0) {
    return true;
  }
  
  return false;

};

// ==================== DETERMINISTIC RESPONSES ====================

/**
 * Build order request response (deterministic)
 */
const buildOrderRequest = (
  missingFields: string[],
  language: Language
): string => {
  const templates = getTemplates(language);
  const fieldsList = missingFields.map((field, i) => `${i + 1}. **${field}**`).join('\n');
  
  return `${templates.ORDERS.preparing}\n\n${fieldsList}\n\n${templates.ORDERS.ready_soon}`;
};

/**
 * Build order confirmation response (deterministic)
 */
const buildOrderConfirmation = (
  customerName: string,
  storeName: string,
  language: Language
): string => {
  const templates = getTemplates(language);
  return templates.ORDERS.confirmed(customerName || 'العميل', storeName);
};

/**
 * Build catalog response (deterministic)
 */
const buildCatalogResponse = (
  products: Product[],
  currency: string,
  language: Language
): string => {
  const templates = getTemplates(language);
  const header = language === 'arabic'
    ? 'تفضل، هذه المنتجات المتوفرة حالياً:'
    : 'Here are the available products:';
  
  const formatted = formatProducts(products, { language, currency }, 5);
  return `${header}\n\n${formatted}\n\n${templates.PRODUCTS.which_prefer}`;
};

/**
 * Build color/size info response (deterministic)
 */
const buildVariantInfoResponse = (
  products: Product[],
  currency: string,
  language: Language,
  wantsColorInfo?: boolean,
  wantsSizeInfo?: boolean
): string => {
  if (products.length === 0) {
    return language === 'arabic' 
      ? 'عذراً، لم أجد المنتج المطلوب.'
      : 'Sorry, I could not find the requested product.';
  }

  const product = products[0];
  const formatted = formatProducts([product], { language, currency }, 1);
  
  // Add specific message about colors/sizes
  let intro = '';
  if (wantsColorInfo && wantsSizeInfo) {
    intro = language === 'arabic'
      ? 'تفضل، هذه الألوان والمقاسات المتوفرة:'
      : 'Here are the available colors and sizes:';
  } else if (wantsColorInfo) {
    intro = language === 'arabic'
      ? 'تفضل، هذه الألوان المتوفرة:'
      : 'Here are the available colors:';
  } else if (wantsSizeInfo) {
    intro = language === 'arabic'
      ? 'تفضل، هذه المقاسات المتوفرة:'
      : 'Here are the available sizes:';
  }

  return `${intro}\n\n${formatted}`;
};

/**
 * Build image request response
 */
const buildImageResponse = async (
  input: ResponseBuilderInput
): Promise<string> => {
  const { products, language, useAI = true } = input;
  const templates = getTemplates(language);

  // Strict: if more than one product, ask user to specify
  if (products.length > 1) {
    return templates.CLARIFY.which_product;
  }

  if (products.length === 1 && products[0].imageUrl) {
    // ✅ ENHANCED: More enthusiastic default response
    let text = language === 'arabic'
      ? `تفضل الصورة! 📸✨\n\n${products[0].name || 'المنتج'} - روعة صح؟ 😍`
      : `Here's the image! 📸✨\n\n${products[0].name || 'The product'} - Amazing, right? 😍`;

    if (useAI) {
      try {
        const aiText = await generateAIResponse(input);
        if (aiText) {
          text = aiText;
        }
      } catch {
        // Keep fallback text
      }
    }

    // Convert image URL to API endpoint for reliable bot delivery (color-aware via message / gallery)
    const resolved = await resolveProductImageForBot({
      merchantId: input.merchantId,
      product: products[0],
      messageText: input.messageText
    });
    const imageUrlForBot =
      resolved.botImageUrl ||
      convertImageUrlForBot(products[0].imageUrl || null, products[0].id);
    const caption = sanitizeCaptionWhenImageSent(text, language, products[0].name);
    return `${caption}\n\n[IMAGE: ${imageUrlForBot}]`;
  }

  return templates.PRODUCTS.not_found;
};

// ==================== AI RESPONSE GENERATION ====================

/**
 * Generate AI response
 */
const generateAIResponse = async (
  input: ResponseBuilderInput
): Promise<string> => {
  const {
    messageText,
    recentMessages,
    intent,
    stage,
    plan,
    products,
    missingFields,
    language,
    persona,
    storeName,
    wantsImage = false,
    wantsCatalog = false,
    systemPrompt: merchantSystemPrompt,
    policies,
    permissions
  } = input;

  // Build prompt context
  const productDetails =
    products.length === 1
      ? [
          `Name: ${products[0].name}`,
          products[0].category ? `Category: ${products[0].category}` : null,
          products[0].description ? `Description: ${products[0].description}` : null,
          products[0].sizes?.length ? `Sizes: ${products[0].sizes.join(', ')}` : null,
          products[0].colors?.length
            ? `Color options: ${products[0].colors.map((c, i) => `${i + 1}) ${c}`).join(' — ')}`
            : null,
          typeof products[0].stock === 'number' ? `Stock: ${products[0].stock}` : null
        ]
          .filter(Boolean)
          .join('\n')
      : undefined;

  const promptContext: PromptContext = {
    storeName,
    language,
    persona,
    intent,
    stage,
    hasProducts: products.length > 0,
    hasHistory: recentMessages.length > 0,
    productsCount: products.length,
    missingFields,
    wantsImage,
    wantsCatalog,
    productsSummary: productDetails,
    systemPrompt: merchantSystemPrompt,
    policies,
    permissions
  };

  const salesPrompt = buildSalesPrompt(promptContext);

  // Build chat messages
  const contents: ChatMessage[] = recentMessages
    .slice(-10)
    .map(msg => ({
      role: msg.role === 'assistant' ? 'model' as const : 'user' as const,
      parts: [{ text: msg.content }]
    }));

  // Add current message
  const lastMsg = recentMessages[recentMessages.length - 1];
  if (!lastMsg || lastMsg.content !== messageText) {
    contents.push({
      role: 'user',
      parts: [{ text: messageText }]
    });
  }

  trackAICall();

  const result = await generateContent(contents, {
    systemInstruction: salesPrompt,
    temperature: 0.4,
    maxOutputTokens: 300
  });

  if (!result.success || !result.text) {
    const templates = getTemplates(language);
    return templates.ERRORS.general;
  }

  let responseText = result.text.trim();

  // Remove repeated greetings if conversation started
  if (recentMessages.length > 0) {
    responseText = responseText
      .replace(/^(يا هلا|أهلاً|مرحبا|السلام عليكم|hello|hi)\s*/i, '')
      .trim();
  }

  return responseText;
};

// ==================== ORDER DATA HELPERS ====================

const extractQuantity = (text: string): number | null => {
  const normalized = text.replace(/[٠-٩]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 1632)
  );
  const match = normalized.match(/(\d+)\s*(قطعة|قطع|حبة|حبات|units?|pcs?)/i);
  if (match?.[1]) {
    const qty = parseInt(match[1], 10);
    return Number.isFinite(qty) && qty > 0 ? qty : null;
  }
  return null;
};

const collectQuantityFromHistory = (
  messageText: string,
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
): number | null => {
  const combined = [
    ...recentMessages.filter(m => m.role === 'user').map(m => m.content),
    messageText
  ].join(' ');
  return extractQuantity(combined);
};

// ==================== MAIN BUILDER ====================

/**
 * Build final response
 * ✅ FIXED: No duplication, single response path
 */
export const buildResponse = async (input: ResponseBuilderInput): Promise<ResponseBuilderResult> => {
  const {
    intent,
    plan,
    products,
    missingFields,
    language,
    currency,
    storeName,
    wantsImage = false,
    wantsCatalog = false,
    wantsColorInfo = false,
    wantsSizeInfo = false,
    useAI = true,
    systemPrompt,
    policies,
    permissions,
    messageText
  } = input;

  let replyText: string;
  let usedAI = false;

  // ==================== PRIORITY 1: DETERMINISTIC RESPONSES ====================
  
  // ✅ Color/Size info request (highest priority - no AI needed)
  if ((wantsColorInfo || wantsSizeInfo) && products.length > 0) {
    replyText = buildVariantInfoResponse(products, currency, language, wantsColorInfo, wantsSizeInfo);
    return { replyText, usedAI: false, guardPassed: true };
  }
  
  // ✅ Catalog request (highest priority - no AI needed)
  if ( wantsCatalog && products.length > 0) {
    replyText = buildCatalogResponse(products, currency, language);
    return { replyText, usedAI: false, guardPassed: true };
  }

  // ✅ CRITICAL: Check if plan.oneQuestion asks about color/size (MUST come BEFORE order request)
  // This ensures we ask about product variants before collecting customer info
  if (plan.oneQuestion && (
    plan.oneQuestion.includes('اللون') || 
    plan.oneQuestion.includes('المقاس') ||
    plan.oneQuestion.includes('color') || 
    plan.oneQuestion.includes('size')
  )) {
    console.log('🎨 Using plan.oneQuestion for color/size', { oneQuestion: plan.oneQuestion });
    replyText = plan.oneQuestion;
    return { replyText, usedAI: false, guardPassed: true };
  }

  // ✅ Image request (MOVED UP - higher priority than order!)
  if (wantsImage) {
    replyText = await buildImageResponse(input);
    return { replyText, usedAI: false, guardPassed: true };
  }

  // ✅ Order request with missing fields
  if ((intent === 'order' || plan.nextAction === 'ask_clarify') && missingFields.length > 0) {
    replyText = buildOrderRequest(missingFields, language);
    return { replyText, usedAI: false, guardPassed: true };
  }

  // ✅ Order confirmation (all fields provided) - stop questions
  if (intent === 'order' && missingFields.length === 0) {
    const userMessages = (input.recentMessages || []).filter(m => m.role === 'user');
    const name = extractName(messageText, userMessages);
    const phone = extractPhone(messageText, userMessages);
    const address = extractAddress(messageText, userMessages);

    const localMissing: string[] = [];
    if (!name) localMissing.push(language === 'arabic' ? 'الاسم الكامل' : 'Full Name');
    if (!phone) localMissing.push(language === 'arabic' ? 'رقم الهاتف' : 'Phone Number');
    if (!address) localMissing.push(language === 'arabic' ? 'العنوان بالتفصيل' : 'Detailed Address');

    if (localMissing.length > 0) {
      replyText = buildOrderRequest(localMissing, language);
      return { replyText, usedAI: false, guardPassed: true };
    }

    const customerName = name || 'العميل';
    replyText = buildOrderConfirmation(customerName, storeName, language);

    // ✅ If we can extract full order data, append ORDER_DATA for CRM saving
    const quantity = collectQuantityFromHistory(messageText, input.recentMessages || []);
    if (products.length > 0) {
      const quantities = quantity ? { [products[0].id]: quantity } : undefined;
      const orderData = buildOrderData({
        customerName: name!,
        customerPhone: phone!,
        customerAddress: address!,
        products,
        quantities,
        notes: 'طلب من خلال البوت'
      });
      replyText = replyText + generateOrderDataTag(orderData);
    }

    return { replyText, usedAI: false, guardPassed: true };
  }

  // ==================== PRIORITY 2: AI RESPONSE (if needed) ====================

  if (useAI && !shouldSkipAI(intent, plan, wantsCatalog, missingFields, products, wantsColorInfo, wantsSizeInfo)) {
    try {
      replyText = await generateAIResponse(input);
      usedAI = true;
      
      // ✅ CRITICAL: If AI response is just a greeting/generic, use plan's question instead
      const isGenericResponse = /^(مرحبا|يا هلا|أهلا|hello|hi|كيف يمكنني)[\s!،,]*/i.test(replyText.trim());
      if (isGenericResponse && plan.oneQuestion) {
        replyText = plan.oneQuestion;
        usedAI = false;
      }
      
    } catch (error) {
      logger.error('AI response generation failed', error as Error);
      // ✅ Fallback to plan's question, not error message
      replyText = plan.oneQuestion || getTemplates(language).ERRORS.general;
    }
  } else {
    // ✅ Use plan's question directly
    replyText = plan.oneQuestion;
  }
// ==================== PRIORITY 3: ADD PRODUCTS (if relevant) ====================

// ✅ Show products with purchase CTA (avoid overriding order flow)
if (
  products.length > 0 &&
  !wantsCatalog &&
  plan.recommendationStrategy &&
  intent !== 'order' &&
  missingFields.length === 0
) {
  const formatted = formatProducts(products, { language, currency }, 3);
  const templates = getTemplates(language);
  
  // ✅ سؤال تحفيزي للشراء
  const purchaseCTA = products.length === 1
    ? (language === 'arabic' 
        ? 'هل تريد طلبه الآن؟ 🛒' 
        : 'Would you like to order it now? 🛒')
    : (language === 'arabic'
        ? 'أي منتج تفضل؟ 🛒'
        : 'Which one would you like? 🛒');
  
  // ✅ استبدال الرد بالكامل بتفاصيل المنتج + السؤال التحفيزي
  replyText = `${formatted}\n\n${purchaseCTA}`;
}

  // ==================== PRIORITY 4: GUARD CHECK ====================

  const guardResult = guardReply({
    replyText,
    plan,
    products,
    language,
    merchantPolicies: {
      shippingPolicy: policies?.shippingPolicy,
      deliveryTime: policies?.deliveryTime,
      paymentMethods: policies?.paymentMethods,
      returnPolicy: policies?.returnPolicy,
      storeCurrency: currency
    }
  });

  return {
    replyText: guardResult.replyText,
    usedAI,
    guardPassed: guardResult.passed
  };
};

// ==================== SIMPLE RESPONSE BUILDERS (EXPORTED) ====================

/**
 * ✅ Build greeting response (no AI)
 */
export const buildGreetingResponse = (language: Language, storeName?: string): string => {
  const templates = getTemplates(language);
  if (storeName) {
    return language === 'arabic'
      ? `مرحباً بك في ${storeName}! كيف يمكنني مساعدتك اليوم؟`
      : `Welcome to ${storeName}! How can I help you today?`;
  }
  return templates.GREETINGS.welcome;
};

/**
 * ✅ Build error response (no AI)
 */
export const buildErrorResponse = (
  errorType: 'general' | 'rate_limit' | 'timeout' | 'not_found',
  language: Language
): string => {
  const templates = getTemplates(language);
  return templates.ERRORS[errorType] || templates.ERRORS.general;
};

/**
 * ✅ Build thank you response (no AI)
 */
export const buildThanksResponse = (language: Language): string => {
  return language === 'arabic'
    ? 'العفو! هل تحتاج مساعدة بشيء آخر؟'
    : 'You\'re welcome! Do you need help with anything else?';
};

/**
 * ✅ Build confirmation response (no AI)
 */
export const buildConfirmationResponse = (language: Language, action: string): string => {
  return language === 'arabic'
    ? `تمام! ${action}. هل هناك شيء آخر؟`
    : `Great! ${action}. Anything else?`;
};

/**
 * ✅ Build clarification request (no AI)
 */
export const buildClarificationRequest = (language: Language, missingInfo: string): string => {
  return language === 'arabic'
    ? `ممكن توضيح أكثر عن ${missingInfo}؟`
    : `Could you clarify about ${missingInfo}?`;
};