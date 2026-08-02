/**
 * Hybrid Sales Writer - Orchestrator Only
 * Product formatting is handled strictly by code (no AI formatting).
 * AI is used only for human text (greeting, encouragement, single question).
 */

import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import { IntentDetectionResult } from './intentDetector.js';
import { SalesPlan } from './salesPlanner.js';
import { ToolResult } from './tools/tool.interface.js';
import { renderProducts } from './productRenderer.js';
import { buildSalesPrompt } from './salesPrompt.js';
import type { ProductLike } from './productFormatter.js';
import { resolveProductImageForBot } from '../catalog/resolve-product-image.js';
import type { Product } from '../core/types.js';

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

const API_KEY = process.env.OPENAI_API_KEY || '';
const DEFAULT_MODEL = 'gpt-4o-mini';
const ai = API_KEY ? new OpenAI({ apiKey: API_KEY }) : null;

export interface HybridWriterInput {
  merchantId: string;
  platform: 'web' | 'facebook_messenger' | 'facebook_comment' | 'telegram';
  messageText: string;
  recentMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  detection: {
    intent: 'greeting' | 'browse' | 'product_query' | 'price' | 'availability' | 'shipping' | 'comparison' | 'order' | 'complaint' | 'other';
    stage: IntentDetectionResult['stage'];
    objection: IntentDetectionResult['objection'];
    entities: IntentDetectionResult['entities'];
    missing_fields: string[];
    detectedLanguage?: 'arabic' | 'english' | 'mixed';
  };
  plan: SalesPlan;
  toolResults?: ToolResult[];
  conversationState: Record<string, any>;
  merchantPolicies?: {
    shippingPolicy?: string;
    deliveryTime?: string;
    paymentMethods?: string;
    returnPolicy?: string;
    additionalNotes?: string;
    storeName?: string;
    storeCurrency?: string;
    systemPrompt?: string;
    persona?: 'formal' | 'friendly' | 'sales' | 'fast' | 'luxury';
    botLanguage?: 'auto' | 'arabic' | 'english';
  };
}

type UserLanguage = 'arabic' | 'english';

function extractOrderInfo(
  messageText: string,
  recentMessages: Array<{ role: string; content: string }>
): { name?: string; phone?: string; address?: string; deliveryTime?: string } {
  const recentText = recentMessages.slice(-5).map(m => m.content).join(' ') + ' ' + messageText;

  const nameMatch = recentText.match(/(?:اسم[ي]?|name|الاسم|اسمي|my name is|انا)[\s:]+([أ-يa-zA-Z\s]{3,40})/i);
  const name = nameMatch?.[1]?.trim();

  const arabicToEnglish = (str: string) => str
    .replace(/[٠]/g, '0').replace(/[١]/g, '1').replace(/[٢]/g, '2')
    .replace(/[٣]/g, '3').replace(/[٤]/g, '4').replace(/[٥]/g, '5')
    .replace(/[٦]/g, '6').replace(/[٧]/g, '7').replace(/[٨]/g, '8')
    .replace(/[٩]/g, '9');
  const normalizedText = arabicToEnglish(recentText);
  const phoneMatch = normalizedText.match(/(\+?963[0-9]{8,9}|09[0-9]{8}|06[0-9]{8}|07[0-9]{8}|[0-9]{7,15})/i);
  const phone = phoneMatch?.[1]?.trim().replace(/\s+/g, '');

  const addressMatch = recentText.match(/(?:عنوان|address|مكان|مدينة|العنوان|المنطقة|الحي|الشارع|street)[\s:]+([أ-ي\s،,0-9]{5,})/i);
  const address = addressMatch?.[1]?.trim();

  const deliveryTimeMatch = recentText.match(/(اليوم|بكرا|غداً|غدا|السبت|الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|صباحاً|مساءً|الظهر|بعد الظهر|المساء|الصبح|العصر|الليل|ليلاً|AM|PM|صباح|مساء|الساعة\s*\d{1,2}(:\d{2})?)/i);
  const deliveryTime = deliveryTimeMatch?.[1]?.trim();

  return { name, phone, address, deliveryTime };
}

function extractNameFromCurrentMessage(messageText: string): string | null {
  const greetingWords = ['السلام', 'مرحبا', 'أهلاً', 'صباح', 'مساء', 'وعليكم', 'الخير', 'سلام', 'هلا', 'مرحب'];
  const keywordMatch = messageText.match(/(?:اسم[ي]?|name|الاسم|اسمي|my name is|انا)[\s:]+([أ-يa-zA-Z\s]{3,40})/i);
  if (keywordMatch?.[1]) {
    return keywordMatch[1].trim();
  }

  const arabicNamePattern = /([أ-ي]{2,15}[\s]+[أ-ي]{2,15})/g;
  const allMatches = messageText.match(arabicNamePattern);
  if (allMatches) {
    for (const match of allMatches) {
      const isGreeting = greetingWords.some(g => match.includes(g));
      if (!isGreeting && match.length >= 5) {
        return match.trim();
      }
    }
  }

  return null;
}

export const generateSalesReply = async (input: HybridWriterInput): Promise<string> => {
  if (!ai) {
    throw new Error('AI service not configured');
  }

  const {
    merchantId,
    messageText,
    recentMessages,
    detection,
    plan,
    toolResults = [],
    conversationState,
    merchantPolicies = {}
  } = input;

  const botLanguage = (merchantPolicies.botLanguage || 'auto').toLowerCase() as 'auto' | 'arabic' | 'english';
  const aiLanguage = detection.detectedLanguage === 'arabic' || detection.detectedLanguage === 'english'
    ? detection.detectedLanguage
    : 'arabic';
  const userLanguage: UserLanguage = botLanguage === 'auto' ? aiLanguage : botLanguage;

  const storeName = merchantPolicies.storeName || 'المتجر';
  const storeCurrency = merchantPolicies.storeCurrency || 'USD';
  const persona = merchantPolicies.persona || 'friendly';

  const catalogResult = toolResults.find(r => r.name === 'catalog' && r.success);
  const products = (catalogResult?.data?.products || []) as ProductLike[];

  const wantsCatalog =
    detection.intent === 'browse' ||
    detection.entities?.wants_catalog === true;

  const maxProducts = wantsCatalog ? Math.min(products.length || 5, 10) : 3;
  const renderedProducts = renderProducts(products, storeCurrency, maxProducts, userLanguage);
  const wantsImage = detection.entities?.wants_image === true;
  const hasHistory = recentMessages.length > 0;

  const isOrder = detection.intent === 'order' || detection.stage === 'close';
  const orderInfo = isOrder ? extractOrderInfo(messageText, recentMessages) : {};
  
  // ✅ Use missing_fields from AI intent detection (more accurate, analyzes full history)
  // Fallback to local calculation only if detection.missing_fields is not available
  const missingFields: string[] = detection.missing_fields && detection.missing_fields.length >= 0
    ? detection.missing_fields
    : (() => {
        // Fallback: local calculation (for backward compatibility)
        const localMissing: string[] = [];
        if (isOrder) {
          const nameInCurrent = extractNameFromCurrentMessage(messageText);
          if (!nameInCurrent) {
            localMissing.push('الاسم الكامل');
          }
          if (!orderInfo.phone) localMissing.push('رقم الهاتف');
          if (!orderInfo.address) localMissing.push('العنوان بالتفصيل');
          // delivery time is optional
        }
        return localMissing;
      })();

  const systemPrompt = buildSalesPrompt({
    storeName,
    userLanguage,
    persona,
    plan,
    detection: { intent: detection.intent, stage: detection.stage },
    missingFields,
    hasProducts: products.length > 0,
    hasHistory,
    wantsImage,
    productsCount: products.length
  });

  logger.info('HybridWriter: generating reply', {
    merchantId,
    intent: detection.intent,
    productsCount: products.length,
    userLanguage,
    nextAction: plan.next_action,
    missingFieldsCount: missingFields.length
  });

  // ✅ CRITICAL: Handle confirm_order action (all mandatory fields provided)
  if (plan.next_action === 'confirm_order') {
    const selectedProduct = products[0] || (conversationState.last_recommended_products?.[0]
      ? { id: conversationState.last_recommended_products[0], name: 'المنتج', price: 0 }
      : null);

    // Extract order info for ORDER_DATA tag
    const finalOrderInfo = extractOrderInfo(messageText, recentMessages);
    const finalName = finalOrderInfo.name || extractNameFromCurrentMessage(messageText) || 'العميل';

    const thankYouMessage = userLanguage === 'arabic'
      ? `شكراً لثقتك ${finalName}! 🙏\n\nتم استلام طلبك بنجاح من متجر ${storeName}، وسنتواصل معك قريباً لتأكيده.`
      : `Thank you for your trust ${finalName}! 🙏\n\nYour order has been received successfully from ${storeName}, and we will contact you soon to confirm it.`;

    // Generate ORDER_DATA tag if we have enough information
    if (finalOrderInfo.name && finalOrderInfo.phone && finalOrderInfo.address && selectedProduct) {
      const orderDataTag = `\n\n[ORDER_DATA]\n{\n  "customerName": "${finalOrderInfo.name}",\n  "customerPhone": "${finalOrderInfo.phone}",\n  "customerEmail": "",\n  "customerAddress": "${finalOrderInfo.address}",\n  "deliveryTime": "${finalOrderInfo.deliveryTime || ''}",\n  "products": [\n    {\n      "productId": "${selectedProduct.id}",\n      "productName": "${selectedProduct.name}",\n      "quantity": 1,\n      "price": ${selectedProduct.price || 0}\n    }\n  ],\n  "total": ${selectedProduct.price || 0},\n  "notes": "طلب من خلال البوت"\n}\n[/ORDER_DATA]`;
      return thankYouMessage + orderDataTag;
    }

    return thankYouMessage;
  }

  // ✅ Deterministic order request (no AI formatting) - only if missing fields exist
  if (isOrder && missingFields.length > 0) {
    const orderText = userLanguage === 'arabic'
      ? `تمام! 😊 عشان أجهزلك الطلب، ممكن تعطيني:\n\n${missingFields.map((m, i) => `${i + 1}. **${m}**`).join('\n')}\n\nبس توصلني هالمعلومات، بجهزلك طلبك فوراً! ✨`
      : `Sure! 😊 To prepare your order, please provide:\n\n${missingFields.map((m, i) => `${i + 1}. **${m}**`).join('\n')}\n\nOnce I receive this info, I'll prepare your order right away! ✨`;
    return orderText;
  }

  // ✅ Deterministic image handling (no AI confusion)
  if (wantsImage) {
    if (products.length > 1) {
      const askWhich = userLanguage === 'arabic'
        ? 'أي منتج تقصد؟'
        : 'Which product do you mean?';
      return askWhich;
    }
    if (products.length === 1 && products[0]?.imageUrl && products[0]?.id) {
      const product = products[0];
      const imageText = userLanguage === 'arabic'
        ? `تفضل صورة ${product.name}.`
        : `Here is an image of ${product.name}.`;
      const productForResolve = {
        id: product.id!,
        imageUrl: product.imageUrl || null,
        colors: (product as ProductLike & { colors?: string[] }).colors || null,
        variants: null
      } as Pick<Product, 'id' | 'imageUrl' | 'colors' | 'variants'>;
      const resolved = await resolveProductImageForBot({
        merchantId,
        product: productForResolve,
        requestedColor: detection.entities?.color || null,
        messageText
      });
      const imageUrlForBot =
        resolved.botImageUrl ||
        convertImageUrlForBot(product.imageUrl || null, product.id!);
      return `${imageText}\n\n[IMAGE: ${imageUrlForBot}]`;
    }
  }

  // ✅ If user wants catalog, return deterministic response + rendered products (no AI formatting)
  if (wantsCatalog && renderedProducts) {
    const browseText = userLanguage === 'arabic'
      ? 'تفضل، هذه المنتجات المتوفرة حالياً:'
      : 'Here are the available products:';
    return `${browseText}\n\n${renderedProducts}`;
  }

  const cleanedMessages = recentMessages
    .slice(-10)
    .filter((msg, index, self) => {
      if (index === 0) return true;
      return !(msg.role === self[index - 1].role && msg.content.trim() === self[index - 1].content.trim());
    });

  const contents = cleanedMessages.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }]
  }));

  const lastMessage = cleanedMessages[cleanedMessages.length - 1];
  if (!lastMessage || lastMessage.content !== messageText) {
    contents.push({
      role: 'user',
      parts: [{ text: messageText }]
    });
  }

  let response;
  try {
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...contents.map((msg) => ({
        role: msg.role === 'model' ? 'assistant' as const : 'user' as const,
        content: msg.parts.map((part) => part.text).join('')
      }))
    ];

    response = await ai.chat.completions.create({
      model: DEFAULT_MODEL,
      messages,
      temperature: 0.4,
      max_tokens: 300,
      top_p: 0.9
    });
  } catch (err) {
    logger.error('HybridWriter AI error', err as Error, { merchantId });
    const fallbackText = userLanguage === 'arabic'
      ? 'عذراً، هناك ضغط على الخدمة حالياً. يرجى المحاولة بعد قليل.'
      : 'Sorry, the service is under heavy load. Please try again shortly.';
    return fallbackText;
  }

  let responseText = (response?.choices?.[0]?.message?.content || '').trim();
  if (!responseText) {
    responseText = userLanguage === 'arabic'
      ? 'يا هلا فيك! كيف فيني أساعدك؟'
      : 'Hi! How can I help you?';
  }

  // Remove repeated greetings if conversation already started
  if (recentMessages.length > 0) {
    responseText = responseText
      .replace(/^(يا هلا|أهلاً|مرحبا|السلام عليكم|وعليكم السلام|hello|hi)\s*/i, '')
      .replace(/(مرحبا|يا هلا|أهلاً|كيف يمكنني مساعدتك اليوم\?)+/gi, '')
      .trim();
  }

  let finalReply = responseText;
  if (wantsCatalog && renderedProducts) {
    finalReply = `${responseText}\n\n${renderedProducts}`;
  }

  // Note: Order confirmation with ORDER_DATA is now handled in the confirm_order action above
  return finalReply;
};
