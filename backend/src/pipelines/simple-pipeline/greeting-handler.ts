/**
 * Greeting Handler - Handle simple greetings without AI
 * Reduces AI costs for common greetings
 */

import type { Language, Message } from '../../core/types.js';
import { buildGreetingResponse } from '../../response/response-builder.js';

// ==================== TYPES ====================

export interface GreetingResult {
  replyText: string;
  shouldContinue: boolean;
}

// ==================== GREETING DETECTION ====================

/**
 * Check if message is a pure greeting
 */
export const isPureGreeting = (messageText: string): boolean => {
  const patterns = [
    /^(السلام عليكم?|وعليكم السلام)[\s!،,.؟?]*$/i,
    /^(مرحبا|مرحباً|أهلاً|اهلا)[\s!،,.؟?]*$/i,
    /^(سلام|هلا|هاي|مرحب)[\s!،,.؟?]*$/i,
    /^(صباح الخير|مساء الخير|صباح النور|مساء النور)[\s!،,.؟?]*$/i,
    /^(hello|hi|hey|good morning|good evening)[\s!,.?]*$/i
  ];

  return patterns.some(p => p.test(messageText.trim()));
};

/**
 * Check if greeting with request (not pure)
 */
export const isGreetingWithRequest = (messageText: string): boolean => {
  const text = messageText.trim();
  
  // Check if starts with greeting
  const greetingStart = /^(السلام|مرحبا|أهلا|سلام|هلا|hello|hi)/i.test(text);
  
  if (!greetingStart) return false;
  
  // Check if has request after greeting
  const requestPatterns = [
    /بدي|أريد|ابي|عايز/i,
    /كم سعر|ما سعر|شو سعر/i,
    /عندكم|متوفر|موجود/i,
    /اطلب|شراء|buy|order/i
  ];
  
  return requestPatterns.some(p => p.test(text));
};

// ==================== GREETING RESPONSES ====================

/**
 * Handle greeting message
 */
export const handleGreeting = (
  messageText: string,
  hasHistory: boolean,
  language: Language,
  storeName?: string
): GreetingResult => {
  // If greeting with request, continue to smart pipeline
  if (isGreetingWithRequest(messageText)) {
    return {
      replyText: '',
      shouldContinue: true
    };
  }

  // If not pure greeting, continue
  if (!isPureGreeting(messageText)) {
    return {
      replyText: '',
      shouldContinue: true
    };
  }

  // Handle returning user
  if (hasHistory) {
    const response = language === 'arabic'
      ? 'أهلاً بك من جديد! كيف يمكنني مساعدتك؟'
      : 'Welcome back! How can I help you?';
    
    return {
      replyText: response,
      shouldContinue: false
    };
  }

  // New user greeting
  const response = buildGreetingResponse(language, storeName);
  
  return {
    replyText: response,
    shouldContinue: false
  };
};

// ==================== TIME-BASED GREETINGS ====================

/**
 * Get appropriate greeting based on time
 */
export const getTimeBasedGreeting = (language: Language): string => {
  const hour = new Date().getHours();
  
  if (language === 'arabic') {
    if (hour >= 5 && hour < 12) return 'صباح الخير!';
    if (hour >= 12 && hour < 17) return 'مساء الخير!';
    return 'مساء النور!';
  }
  
  if (hour >= 5 && hour < 12) return 'Good morning!';
  if (hour >= 12 && hour < 17) return 'Good afternoon!';
  return 'Good evening!';
};
