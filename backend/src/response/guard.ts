/**
 * Response Guard - Quality checks for bot replies
 * Prevents long essays, hallucinations, and repetition
 */

import { logger } from '../utils/logger.js';
import type { Product, Language } from '../core/types.js';
import type { SalesPlan } from '../sales/sales-rules.js';

// ==================== TYPES ====================

export interface GuardInput {
  replyText: string;
  plan: SalesPlan;
  products?: Product[];
  merchantPolicies?: {
    shippingPolicy?: string;
    deliveryTime?: string;
    paymentMethods?: string;
    returnPolicy?: string;
    storeCurrency?: string;
  };
  recentReplies?: string[];
  language?: Language;
}

export interface GuardResult {
  passed: boolean;
  replyText: string;
  violations: string[];
  warnings: string[];
}

// ==================== CONSTANTS ====================

const MAX_WORDS = 80;
const MAX_QUESTIONS = 1;
const MIN_WORDS = 8;
const SIMILARITY_THRESHOLD = 0.6;

// ==================== HELPER FUNCTIONS ====================

/**
 * Extract numbers from text (including Arabic numerals)
 */
const extractNumbers = (text: string): number[] => {
  const numbers: number[] = [];
  const normalizedText = text.replace(/[٠-٩]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 1632)
  );
  
  const matches = normalizedText.match(/[\d]+(?:\.\d+)?/g);
  if (matches) {
    matches.forEach(match => {
      const num = parseFloat(match);
      if (!isNaN(num) && num > 0) {
        numbers.push(num);
      }
    });
  }
  
  return numbers;
};

/**
 * Get allowed numbers from products and policies
 */
const getAllowedNumbers = (
  products: Product[],
  policies?: GuardInput['merchantPolicies']
): Set<number> => {
  const allowed = new Set<number>();
  
  products.forEach(product => {
    if (product.price) allowed.add(product.price);
    if (product.stock) allowed.add(product.stock);
  });
  
  if (policies) {
    [policies.shippingPolicy, policies.deliveryTime].forEach(text => {
      if (text) {
        extractNumbers(text).forEach(n => allowed.add(n));
      }
    });
  }
  
  return allowed;
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
  
  // Try to end at sentence boundary
  const lastEnd = Math.max(
    trimmed.lastIndexOf('.'),
    trimmed.lastIndexOf('!'),
    trimmed.lastIndexOf('؟'),
    trimmed.lastIndexOf('?')
  );
  
  if (lastEnd > maxWords * 0.6) {
    return trimmed.substring(0, lastEnd + 1).trim();
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
 * Calculate text similarity (Jaccard)
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
 * Check for internal repetition
 */
const hasRepetition = (text: string): { has: boolean; phrase?: string } => {
  const sentences = text.split(/[.!?؟،,]\s*/);
  
  for (let i = 0; i < sentences.length - 1; i++) {
    for (let j = i + 1; j < sentences.length; j++) {
      if (sentences[i].length > 15 && calculateSimilarity(sentences[i], sentences[j]) > 0.7) {
        return { has: true, phrase: sentences[i] };
      }
    }
  }
  
  return { has: false };
};

/**
 * Remove repetitive content
 */
const removeRepetition = (text: string): string => {
  const sentences = text.split(/([.!?؟])\s*/);
  const seen = new Set<string>();
  const result: string[] = [];
  
  for (let i = 0; i < sentences.length; i += 2) {
    const sentence = sentences[i];
    const punct = sentences[i + 1] || '';
    
    if (!sentence || sentence.length < 5) continue;
    
    let isDuplicate = false;
    for (const seenSentence of seen) {
      if (calculateSimilarity(sentence, seenSentence) > 0.6) {
        isDuplicate = true;
        break;
      }
    }
    
    if (!isDuplicate) {
      seen.add(sentence);
      result.push(sentence + punct);
    }
  }
  
  return result.join(' ').trim();
};

/**
 * Strip redundant greetings
 */
const stripRedundantGreetings = (text: string): string => {
  const greetings = [
    /^(أهلاً|اهلا|مرحبا|مرحباً|سلام|هلا|هاي)[!،,.\s]*/gi,
    /^(hi|hello|hey)[!,.\s]*/gi
  ];
  
  let result = text;
  let count = 0;
  
  for (const pattern of greetings) {
    if (pattern.test(result)) {
      count++;
      if (count > 1) {
        result = result.replace(pattern, '');
      }
    }
  }
  
  return result.trim();
};

/**
 * Remove filler phrases
 */
const removeFillers = (text: string): string => {
  const fillers = [
    /بكل تأكيد[،,]?\s*/gi,
    /طبعاً[،,]?\s*/gi,
    /بالطبع[،,]?\s*/gi,
    /certainly[،,]?\s*/gi,
    /of course[،,]?\s*/gi
  ];
  
  let result = text;
  for (const filler of fillers) {
    result = result.replace(filler, '');
  }
  
  return result.trim();
};

// ==================== MAIN GUARD ====================

/**
 * Guard bot reply quality
 */
export const guardReply = (input: GuardInput): GuardResult => {
  const {
    replyText,
    plan,
    products = [],
    merchantPolicies,
    recentReplies = [],
    language = 'arabic'
  } = input;

  const violations: string[] = [];
  const warnings: string[] = [];

  // Check if error reply (don't modify)
  const isError = /عذراً.*خطأ|sorry.*error|service.*busy/i.test(replyText);
  const isOrderRelated = /ORDER_DATA|شكراً.*طلب|عشان أجهزلك/i.test(replyText);

  // Protect IMAGE tags
  const imageTagRegex = /\[IMAGE:\s*[^\]]+\]/gi;
  const imageTags = replyText.match(imageTagRegex) || [];
  let cleaned = replyText.replace(imageTagRegex, '').trim();

  // ==================== CLEANUP ====================
  cleaned = stripRedundantGreetings(cleaned);
  cleaned = removeFillers(cleaned);

  // ==================== CHECK: Repetition ====================
  const rep = hasRepetition(cleaned);
  if (rep.has) {
    violations.push(`Repetitive content (phraseLength=${rep.phrase?.length || 0})`);
    cleaned = removeRepetition(cleaned);
    warnings.push('Removed repetition');
  }

  // ==================== CHECK: Similar to recent ====================
  for (const recent of recentReplies.slice(-3)) {
    const sim = calculateSimilarity(cleaned, recent);
    if (sim > SIMILARITY_THRESHOLD) {
      violations.push(`Too similar to recent reply (${Math.round(sim * 100)}%)`);
      break;
    }
  }

  // ==================== CHECK: Length ====================
  const wordCount = countWords(cleaned);
  if (wordCount > MAX_WORDS) {
    violations.push(`Exceeds ${MAX_WORDS} words (${wordCount})`);
    cleaned = trimToMaxWords(cleaned, MAX_WORDS);
    warnings.push(`Trimmed to ${countWords(cleaned)} words`);
  }

  // ==================== CHECK: Questions ====================
  const questionCount = countQuestions(cleaned);
  
  if (questionCount === 0 && plan.oneQuestion && !isError && !isOrderRelated) {
    violations.push('No question in reply');
    cleaned = cleaned.trim();
    if (!cleaned.endsWith('.') && !cleaned.endsWith('!')) {
      cleaned += '.';
    }
    cleaned += ' ' + plan.oneQuestion;
    warnings.push('Added planned question');
  } else if (questionCount > MAX_QUESTIONS) {
    violations.push(`Too many questions (${questionCount})`);
    // Keep only last question
    const parts = cleaned.split(/([؟?])/);
    if (parts.length > 2) {
      const lastQ = parts.slice(-2).join('');
      const before = parts.slice(0, -2).join('').replace(/[؟?]/g, '.').trim();
      cleaned = before + ' ' + lastQ;
    }
    warnings.push('Removed extra questions');
  }

  // ==================== CHECK: Hallucinated Numbers ====================
  const numbersInReply = extractNumbers(cleaned);
  const allowedNumbers = getAllowedNumbers(products, merchantPolicies);
  
  const suspicious = numbersInReply.filter(num => {
    if (num <= 10) return false; // Small numbers OK
    return !Array.from(allowedNumbers).some(allowed => Math.abs(num - allowed) < 0.01);
  });

  if (suspicious.length > 0) {
    violations.push(`Suspicious numbers: ${suspicious.join(', ')}`);
    suspicious.forEach(num => {
      cleaned = cleaned.replace(new RegExp(num.toString(), 'g'), '');
    });
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    warnings.push('Removed hallucinated numbers');
  }

  // ==================== FINAL CLEANUP ====================
  if (cleaned && !cleaned.match(/[.!?؟]$/)) {
    cleaned += '.';
  }

  // Restore IMAGE tags
  if (imageTags.length > 0) {
    cleaned = cleaned.trim() + '\n\n' + imageTags.join('\n');
  }

  const passed = violations.length === 0;

  logger.debug('Guard check completed', {
    passed,
    violations: violations.length,
    warnings: warnings.length
  });

  return {
    passed,
    replyText: cleaned,
    violations,
    warnings
  };
};
