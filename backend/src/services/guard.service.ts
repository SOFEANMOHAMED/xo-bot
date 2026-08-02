/**
 * Guard Service - Prevent long essays, hallucinations, and repetition
 * Quality checks for bot replies - Optimized for professional sales bot
 */

import { logger } from '../utils/logger.js';
import { ToolResult } from './tools/tool.interface.js';
import { SalesPlan } from './salesPlanner.js';

export interface GuardInput {
  replyText: string;
  plan: SalesPlan;
  toolResults?: ToolResult[];
  merchantPolicies?: {
    shippingPolicy?: string;
    deliveryTime?: string;
    paymentMethods?: string;
    returnPolicy?: string;
    storeCurrency?: string;
  };
  recentReplies?: string[]; // Previous bot replies for repetition check
}

export interface GuardResult {
  passed: boolean;
  replyText: string;
  violations: string[];
  warnings: string[];
}

// ==================== CONSTANTS ====================
const MAX_WORDS = 80; // Reduced from 120 for faster, more direct responses
const MAX_QUESTIONS = 1;
const MIN_WORDS = 10;
const SIMILARITY_THRESHOLD = 0.6; // 60% similarity = too repetitive

// ==================== HELPER FUNCTIONS ====================

/**
 * Extract all numbers from text
 */
const extractNumbers = (text: string): number[] => {
  const numbers: number[] = [];
  const numberRegex = /[\d٠-٩]+(?:\.\d+)?/g;
  const matches = text.match(numberRegex);
  
  if (matches) {
    matches.forEach(match => {
      const normalized = match.replace(/[٠-٩]/g, (char) => {
        return String.fromCharCode(char.charCodeAt(0) - 1632);
      });
      const num = parseFloat(normalized);
      if (!isNaN(num) && num > 0) {
        numbers.push(num);
      }
    });
  }
  
  return numbers;
};

/**
 * Extract allowed numbers from toolResults and policies
 */
const extractAllowedNumbers = (
  toolResults: ToolResult[],
  merchantPolicies?: GuardInput['merchantPolicies']
): Set<number> => {
  const allowedNumbers = new Set<number>();
  
  toolResults.forEach(result => {
    if (result.success && result.data) {
      if (result.data.products && Array.isArray(result.data.products)) {
        result.data.products.forEach((product: any) => {
          if (product.price) allowedNumbers.add(parseFloat(product.price));
          if (product.stock !== undefined) allowedNumbers.add(parseInt(product.stock));
          if (product.quantity) allowedNumbers.add(parseInt(product.quantity));
        });
      }
      if (typeof result.data.price === 'number') allowedNumbers.add(result.data.price);
      if (typeof result.data.stock === 'number') allowedNumbers.add(result.data.stock);
    }
  });
  
  if (merchantPolicies) {
    if (merchantPolicies.shippingPolicy) {
      extractNumbers(merchantPolicies.shippingPolicy).forEach(n => allowedNumbers.add(n));
    }
    if (merchantPolicies.deliveryTime) {
      extractNumbers(merchantPolicies.deliveryTime).forEach(n => allowedNumbers.add(n));
    }
  }
  
  return allowedNumbers;
};

/**
 * Count words in text
 */
const countWords = (text: string): number => {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
};

/**
 * Trim text to max words
 */
const trimToMaxWords = (text: string, maxWords: number): string => {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text;
  
  const trimmed = words.slice(0, maxWords).join(' ');
  const lastSentenceEnd = Math.max(
    trimmed.lastIndexOf('.'),
    trimmed.lastIndexOf('!'),
    trimmed.lastIndexOf('؟'),
    trimmed.lastIndexOf('?')
  );
  
  if (lastSentenceEnd > maxWords * 0.6) {
    return trimmed.substring(0, lastSentenceEnd + 1).trim();
  }
  
  return trimmed + '...';
};

/**
 * Count questions in text
 */
const countQuestions = (text: string): number => {
  return (text.match(/[؟?]/g) || []).length;
};

/**
 * Calculate text similarity (Jaccard Index)
 */
const calculateSimilarity = (text1: string, text2: string): number => {
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
};

/**
 * Check for repetitive phrases within the text
 */
const hasRepetitivePhrases = (text: string): { hasRepetition: boolean; repeatedPhrase?: string } => {
  const sentences = text.split(/[.!?؟،,]\s*/);
  
  for (let i = 0; i < sentences.length - 1; i++) {
    for (let j = i + 1; j < sentences.length; j++) {
      const similarity = calculateSimilarity(sentences[i], sentences[j]);
      if (similarity > 0.7 && sentences[i].length > 15) {
        return { hasRepetition: true, repeatedPhrase: sentences[i] };
      }
    }
  }
  
  return { hasRepetition: false };
};

/**
 * Remove repetitive content from text
 */
const removeRepetition = (text: string): string => {
  const sentences = text.split(/([.!?؟])\s*/);
  const seen = new Set<string>();
  const result: string[] = [];
  
  for (let i = 0; i < sentences.length; i += 2) {
    const sentence = sentences[i];
    const punctuation = sentences[i + 1] || '';
    
    if (!sentence || sentence.length < 5) continue;
    
    // Check if this sentence is too similar to any seen sentence
    let isDuplicate = false;
    for (const seenSentence of seen) {
      if (calculateSimilarity(sentence, seenSentence) > 0.6) {
        isDuplicate = true;
        break;
      }
    }
    
    if (!isDuplicate) {
      seen.add(sentence);
      result.push(sentence + punctuation);
    }
  }
  
  return result.join(' ').trim();
};

/**
 * Keep only planned question, remove extras
 */
const keepOnlyPlannedQuestion = (text: string, plannedQuestion: string): string => {
  const sentences = text.split(/[.!?؟]\s+/);
  
  const nonQuestionSentences = sentences.filter(s => countQuestions(s) === 0);
  
  // Check if planned question is already in text
  const hasPlannedQuestion = sentences.some(s => 
    s.toLowerCase().includes(plannedQuestion.toLowerCase().substring(0, 20))
  );
  
  if (hasPlannedQuestion) {
    // Keep non-question sentences + the one containing planned question
    const filtered = sentences.filter((s, _idx) => {
      if (countQuestions(s) > 0) {
        return s.toLowerCase().includes(plannedQuestion.toLowerCase().substring(0, 20));
      }
      return true;
    });
    return filtered.join('. ').trim();
  }
  
  // Add planned question at the end
  return nonQuestionSentences.join('. ').trim() + ' ' + plannedQuestion;
};

/**
 * Strip redundant greetings
 */
const stripRedundantGreeting = (text: string): string => {
  // Remove multiple greetings
  const greetingPatterns = [
    /^(أهلاً|اهلا|مرحبا|مرحباً|سلام|السلام عليكم|هلا|هاي)[!،,.\s]*/gi,
    /^(hi|hello|hey|good morning|good evening)[!,.\s]*/gi
  ];
  
  let result = text;
  let greetingsFound = 0;
  
  for (const pattern of greetingPatterns) {
    if (pattern.test(result)) {
      greetingsFound++;
      if (greetingsFound > 1) {
        result = result.replace(pattern, '');
      }
    }
  }
  
  return result.trim();
};

/**
 * Remove filler phrases that don't add value
 */
const removeFillerPhrases = (text: string): string => {
  const fillers = [
    /بكل تأكيد[،,]?\s*/gi,
    /طبعاً[،,]?\s*/gi,
    /بالطبع[،,]?\s*/gi,
    /certainly[،,]?\s*/gi,
    /of course[،,]?\s*/gi,
    /definitely[،,]?\s*/gi,
    /sure thing[،,]?\s*/gi
  ];
  
  let result = text;
  for (const filler of fillers) {
    result = result.replace(filler, '');
  }
  
  return result.trim();
};

// ==================== MAIN GUARD FUNCTION ====================

/**
 * Guard service - Quality checks for bot replies
 * 
 * Checks:
 * 1. Length <= 80 words
 * 2. Exactly ONE question
 * 3. No hallucinated numbers
 * 4. No repetition (internal + vs recent replies)
 * 5. No excessive greetings
 */
export const guardReply = (input: GuardInput): GuardResult => {
  const {
    replyText,
    plan,
    toolResults = [],
    merchantPolicies,
    recentReplies = []
  } = input;

  const violations: string[] = [];
  const warnings: string[] = [];
  const isErrorReply = /عذراً، هناك ضغط على الخدمة|حدث خطأ في معالجة|الخدمة مشغولة|Service is currently busy|something went wrong while processing/i.test(replyText);
  
  // ==================== PROTECT IMAGE TAG ====================
  // Extract [IMAGE: url] tag to protect it from trimming/modification
  const imageTagRegex = /\[IMAGE:\s*[^\]]+\]/gi;
  const imageTags = replyText.match(imageTagRegex) || [];
  let cleanedReply = replyText.replace(imageTagRegex, '').trim();

  logger.debug('Guard: Checking reply quality', {
    originalLength: replyText.length,
    wordCount: countWords(cleanedReply),
    hasImageTag: imageTags.length > 0
  });

  // ==================== CHECK 0: Basic Cleanup ====================
  cleanedReply = stripRedundantGreeting(cleanedReply);
  cleanedReply = removeFillerPhrases(cleanedReply);

  // ==================== CHECK 1: Internal Repetition ====================
  const { hasRepetition, repeatedPhrase } = hasRepetitivePhrases(cleanedReply);
  if (hasRepetition) {
    violations.push(`Reply contains repetitive content: "${repeatedPhrase?.substring(0, 30)}..."`);
    cleanedReply = removeRepetition(cleanedReply);
    warnings.push('Removed repetitive phrases');
  }

  // ==================== CHECK 2: Similar to Recent Replies ====================
  for (const recentReply of recentReplies.slice(-3)) {
    const similarity = calculateSimilarity(cleanedReply, recentReply);
    if (similarity > SIMILARITY_THRESHOLD) {
      violations.push(`Reply is too similar to recent reply (${Math.round(similarity * 100)}% similar)`);
      warnings.push('Consider rephrasing to avoid repetition');
      // Don't modify, just warn - the AI should learn to vary responses
      break;
    }
  }

  // ==================== CHECK 3: Length Check ====================
  const wordCount = countWords(cleanedReply);
  if (wordCount > MAX_WORDS) {
    violations.push(`Reply exceeds ${MAX_WORDS} words (${wordCount} words)`);
    cleanedReply = trimToMaxWords(cleanedReply, MAX_WORDS);
    warnings.push(`Trimmed to ${countWords(cleanedReply)} words`);
  }
  
  if (wordCount < MIN_WORDS && plan.one_question && !isErrorReply) {
    // ✅ لا تضف السؤال إذا كان الرد عن طلب أو طلب معلومات
    const isOrderRelated = replyText.includes('ORDER_DATA') || 
                           replyText.includes('شكراً') || 
                           replyText.includes('تم إعداد') ||
                           replyText.includes('تم تأكيد') ||
                           replyText.includes('عشان أجهزلك') ||
                           replyText.includes('ممكن تعطيني') ||
                           replyText.includes('بجهزلك طلبك') ||
                           replyText.includes('الاسم الكامل') ||
                           replyText.includes('رقم الهاتف') ||
                           replyText.includes('العنوان');
    if (!isOrderRelated) {
      cleanedReply = cleanedReply.trim() + ' ' + plan.one_question;
      warnings.push('Added planned question to short reply');
    }
  }

  // ==================== CHECK 4: Question Count ====================
  const questionCount = countQuestions(cleanedReply);
  
  if (questionCount === 0 && plan.one_question && !isErrorReply) {
    // ✅ لا تضف السؤال إذا كان الرد عن طلب أو طلب معلومات
    const isOrderRelated = replyText.includes('ORDER_DATA') || 
                           replyText.includes('شكراً') || 
                           replyText.includes('تم إعداد') ||
                           replyText.includes('تم تأكيد') ||
                           replyText.includes('سنتواصل معك') ||
                           replyText.includes('عشان أجهزلك') ||
                           replyText.includes('ممكن تعطيني') ||
                           replyText.includes('بجهزلك طلبك') ||
                           replyText.includes('الاسم الكامل') ||
                           replyText.includes('رقم الهاتف') ||
                           replyText.includes('العنوان');
    if (!isOrderRelated) {
      violations.push('Reply has no question');
      cleanedReply = cleanedReply.trim();
      if (!cleanedReply.endsWith('.') && !cleanedReply.endsWith('!')) {
        cleanedReply += '.';
      }
      cleanedReply += ' ' + plan.one_question;
      warnings.push('Added planned question');
    }
  } else if (questionCount > MAX_QUESTIONS) {
    violations.push(`Reply has ${questionCount} questions (max ${MAX_QUESTIONS})`);
    cleanedReply = keepOnlyPlannedQuestion(cleanedReply, plan.one_question);
    warnings.push('Removed extra questions');
  }

  // ==================== CHECK 5: Hallucinated Numbers ====================
  const numbersInReply = extractNumbers(cleanedReply);
  const allowedNumbers = extractAllowedNumbers(toolResults, merchantPolicies);
  
  const suspiciousNumbers = numbersInReply.filter(num => {
    if (num <= 10) return false; // Allow small numbers
    return !Array.from(allowedNumbers).some(allowed => Math.abs(num - allowed) < 0.01);
  });

  if (suspiciousNumbers.length > 0) {
    violations.push(`Suspicious numbers found: ${suspiciousNumbers.join(', ')}`);
    
    // Replace suspicious numbers with placeholder or remove
    suspiciousNumbers.forEach(num => {
      const pattern = new RegExp(num.toString().replace(/\./g, '\\.'), 'g');
      cleanedReply = cleanedReply.replace(pattern, '');
    });
    
    // Clean up any double spaces
    cleanedReply = cleanedReply.replace(/\s+/g, ' ').trim();
    warnings.push('Removed hallucinated numbers');
  }

  // ==================== FINAL CLEANUP ====================
  
  // Ensure reply ends properly
  if (cleanedReply && !cleanedReply.match(/[.!?؟]$/)) {
    cleanedReply += '.';
  }
  
  // Final word count check
  const finalWordCount = countWords(cleanedReply);
  if (finalWordCount > MAX_WORDS) {
    cleanedReply = trimToMaxWords(cleanedReply, MAX_WORDS);
  }

  // ==================== RESTORE IMAGE TAG ====================
  // Add back the protected image tag(s) at the end
  if (imageTags.length > 0) {
    cleanedReply = cleanedReply.trim() + '\n\n' + imageTags.join('\n');
  }

  const passed = violations.length === 0;

  logger.info('Guard: Quality check completed', {
    passed,
    violations: violations.length,
    warnings: warnings.length,
    originalWords: countWords(replyText),
    finalWords: countWords(cleanedReply),
    hasImageTag: imageTags.length > 0
  });

  return {
    passed,
    replyText: cleanedReply,
    violations,
    warnings
  };
};
