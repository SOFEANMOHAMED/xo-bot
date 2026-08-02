/**
 * Order Handler - Handle simple order-related messages
 * No AI needed for common order patterns
 */

import type { Language, ConversationState, Message } from '../../core/types.js';
import { extractName, extractPhone, extractAddress, extractDeliveryTime } from '../../orders/order-validator.js';

// ==================== TYPES ====================

export interface OrderHandlerResult {
  replyText: string;
  shouldContinue: boolean;
  extractedField?: {
    type: 'name' | 'phone' | 'address' | 'deliveryTime' | 'city';
    value: string;
  };
}

// ==================== PATTERNS ====================

// Order intent patterns
const ORDER_INTENT_PATTERNS = [
  /^(بدي اطلب|أريد الطلب|اطلبلي|جهزلي|نفذ الطلب|أكد الطلب)[\s!،,.]*$/i,
  /^(order|place order|confirm order|buy|purchase)[\s!,.]*$/i
];

// Cancel patterns
const CANCEL_PATTERNS = [
  /^(الغ[يا]?|الغاء|ما بدي|لا شكرا)[\s!،,.]*$/i,
  /^(cancel|nevermind|never mind|stop)[\s!,.]*$/i
];

// Phone number pattern (standalone)
const PHONE_STANDALONE = /^[\d٠-٩\s\-\+]{7,15}$/;

// ==================== DETECTION ====================

/**
 * Check if message is order intent
 */
export const isOrderIntent = (messageText: string): boolean => {
  return ORDER_INTENT_PATTERNS.some(p => p.test(messageText.trim()));
};

/**
 * Check if message is cancel intent
 */
export const isCancelIntent = (messageText: string): boolean => {
  return CANCEL_PATTERNS.some(p => p.test(messageText.trim()));
};

/**
 * Check if message looks like a phone number
 */
export const isPhoneNumber = (messageText: string): boolean => {
  const normalized = messageText.trim().replace(/[\s\-\.]/g, '');
  return PHONE_STANDALONE.test(normalized);
};

/**
 * Check if message looks like an address
 */
export const isAddress = (messageText: string): boolean => {
  const addressIndicators = ['شارع', 'منطقة', 'حي', 'مبنى', 'بناية', 'طابق', 'قرب', 'جانب', 'street', 'building', 'floor', 'near'];
  const text = messageText.toLowerCase();
  return addressIndicators.some(ind => text.includes(ind)) && messageText.length > 10;
};

/**
 * Check if message looks like a name (2-4 Arabic/English words)
 */
export const isName = (messageText: string): boolean => {
  const words = messageText.trim().split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  
  // Check if it's Arabic or English name
  const isArabic = /^[أ-ي\s]{4,40}$/.test(messageText.trim());
  const isEnglish = /^[a-zA-Z\s]{4,40}$/.test(messageText.trim());
  
  if (!isArabic && !isEnglish) return false;
  
  // Exclude greetings and common words
  const excluded = ['السلام', 'مرحبا', 'أهلا', 'شكرا', 'hello', 'hi', 'thanks', 'نعم', 'لا'];
  return !excluded.some(w => messageText.toLowerCase().includes(w.toLowerCase()));
};

/**
 * Check if message looks like delivery time
 */
export const isDeliveryTime = (messageText: string): boolean => {
  const timePatterns = [
    /اليوم|بكرا|غداً|غدا/i,
    /السبت|الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة/i,
    /صباحاً|مساءً|الظهر|بعد الظهر|المساء|الصبح|العصر/i,
    /today|tomorrow|morning|afternoon|evening/i
  ];
  
  return timePatterns.some(p => p.test(messageText));
};

// ==================== HANDLERS ====================

/**
 * Handle order-related message
 */
export const handleOrderMessage = (
  messageText: string,
  conversationState: ConversationState,
  recentMessages: Message[],
  language: Language
): OrderHandlerResult => {
  const text = messageText.trim();
  const lastIntent = conversationState.last_intent;
  const missingFields = conversationState.missing_fields || [];

  // If not in order context, check for order intent
  if (lastIntent !== 'order') {
    if (isOrderIntent(text)) {
      return {
        replyText: '',
        shouldContinue: true // Continue to smart pipeline for full order flow
      };
    }
    
    // Not order-related
    return {
      replyText: '',
      shouldContinue: true
    };
  }

  // ==================== IN ORDER CONTEXT ====================

  // Cancel order
  if (isCancelIntent(text)) {
    const response = language === 'arabic'
      ? 'تم إلغاء الطلب. كيف يمكنني مساعدتك؟'
      : 'Order cancelled. How can I help you?';
    
    return {
      replyText: response,
      shouldContinue: false
    };
  }

  // Check if message is providing missing info
  const needsName = missingFields.some(f => f.includes('اسم') || f.includes('Name'));
  const needsPhone = missingFields.some(f => f.includes('هاتف') || f.includes('Phone'));
  const needsAddress = missingFields.some(f => f.includes('عنوان') || f.includes('Address'));
  const needsTime = missingFields.some(f => f.includes('وقت') || f.includes('Time'));

  // Try to extract based on what's needed
  if (needsPhone && isPhoneNumber(text)) {
    const phone = extractPhone(text, []);
    if (phone) {
      return {
        replyText: '',
        shouldContinue: true, // Continue to smart pipeline to update state
        extractedField: { type: 'phone', value: phone }
      };
    }
  }

  if (needsName && isName(text)) {
    const name = extractName(text, []);
    if (name) {
      return {
        replyText: '',
        shouldContinue: true,
        extractedField: { type: 'name', value: name }
      };
    }
  }

  if (needsAddress && isAddress(text)) {
    const address = extractAddress(text, []);
    if (address) {
      return {
        replyText: '',
        shouldContinue: true,
        extractedField: { type: 'address', value: address }
      };
    }
  }

  if (needsTime && isDeliveryTime(text)) {
    const time = extractDeliveryTime(text, []);
    if (time) {
      return {
        replyText: '',
        shouldContinue: true,
        extractedField: { type: 'deliveryTime', value: time }
      };
    }
  }

  // Can't determine what user provided - continue to smart pipeline
  return {
    replyText: '',
    shouldContinue: true
  };
};

// ==================== ORDER CONFIRMATION ====================

/**
 * Check if user is confirming order
 */
export const isOrderConfirmation = (
  messageText: string,
  conversationState: ConversationState
): boolean => {
  if (conversationState.last_intent !== 'order') return false;
  
  // ✅ ENHANCED: More flexible confirmation patterns
  const confirmPatterns = [
    /^(نعم|أي|اي|تمام|موافق|أكيد|أكد|نفذ)(\s+(بس|فقط|وحدة|واحدة|١|1))?\s*[\d١-٩]*[\s!،,.]*$/i,
    /^(yes|confirm|ok|okay|sure)(\s+(just|only|one))?\s*[\d]*[\s!,.]*$/i,
    /^(لك|ايه)\s+(بس|فقط|اي|نعم|تمام)/i,  // "لك اي بس وحدة"
    /^(بس|فقط)\s+(نعم|اي|تمام|موافق|وحدة|واحدة)/i  // "بس نعم" or "بس وحدة"
  ];
  
  return confirmPatterns.some(p => p.test(messageText.trim()));
};

/**
 * Check if all order info is complete
 */
export const isOrderComplete = (conversationState: ConversationState): boolean => {
  const missingFields = conversationState.missing_fields || [];
  return missingFields.length === 0;
};
