/**
 * Error Handler - Centralized error handling for the bot
 * Provides consistent error responses and logging
 */

import { logger } from '../utils/logger.js';
import type { Language } from './types.js';

// ==================== ERROR TYPES ====================

export type ErrorType = 
  | 'rate_limit'
  | 'timeout'
  | 'api'
  | 'database'
  | 'validation'
  | 'not_found'
  | 'unknown';

export interface BotError {
  type: ErrorType;
  message: string;
  originalError?: Error;
  context?: Record<string, unknown>;
}

// ==================== ERROR MESSAGES ====================

const ERROR_MESSAGES: Record<ErrorType, { ar: string; en: string }> = {
  rate_limit: {
    ar: 'عذراً، هناك ضغط على الخدمة حالياً. يرجى المحاولة مرة أخرى بعد قليل.',
    en: 'Sorry, the service is currently busy. Please try again shortly.'
  },
  timeout: {
    ar: 'استغرق الرد وقتاً طويلاً. كيف يمكنني مساعدتك؟',
    en: 'The response took too long. How can I help you?'
  },
  api: {
    ar: 'عذراً، هناك مشكلة في الاتصال. يرجى المحاولة مرة أخرى.',
    en: 'Sorry, there was a connection problem. Please try again.'
  },
  database: {
    ar: 'عذراً، هناك مشكلة تقنية. يرجى المحاولة مرة أخرى.',
    en: 'Sorry, there was a technical issue. Please try again.'
  },
  validation: {
    ar: 'عذراً، لم نفهم طلبك. يرجى إعادة صياغته.',
    en: 'Sorry, we did not understand your request. Please rephrase it.'
  },
  not_found: {
    ar: 'عذراً، لم نجد ما تبحث عنه. هل يمكنك توضيح طلبك؟',
    en: 'Sorry, we could not find what you are looking for. Can you clarify?'
  },
  unknown: {
    ar: 'عذراً، حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.',
    en: 'Sorry, an unexpected error occurred. Please try again.'
  }
};

// ==================== ERROR CATEGORIZATION ====================

/**
 * Categorize error type from error object
 */
export const categorizeError = (error: unknown): ErrorType => {
  if (!(error instanceof Error)) {
    return 'unknown';
  }

  const message = error.message.toLowerCase();
  const code = (error as any).code || (error as any).status;

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

  // Validation errors
  if (message.includes('validation') || message.includes('invalid') || message.includes('required')) {
    return 'validation';
  }

  // Not found errors
  if (code === 404 || message.includes('not found')) {
    return 'not_found';
  }

  return 'unknown';
};

// ==================== ERROR RESPONSE ====================

/**
 * Get user-friendly error message
 */
export const getErrorMessage = (errorType: ErrorType, language: Language = 'arabic'): string => {
  return ERROR_MESSAGES[errorType][language === 'arabic' ? 'ar' : 'en'];
};

/**
 * Create BotError from unknown error
 */
export const createBotError = (
  error: unknown,
  context?: Record<string, unknown>
): BotError => {
  const type = categorizeError(error);
  const originalError = error instanceof Error ? error : new Error(String(error));

  return {
    type,
    message: originalError.message,
    originalError,
    context
  };
};

// ==================== ERROR LOGGING ====================

/**
 * Log error with context
 */
export const logError = (
  botError: BotError,
  additionalContext?: Record<string, unknown>
): void => {
  logger.error(`Bot Error [${botError.type}]: ${botError.message}`, botError.originalError, {
    errorType: botError.type,
    ...botError.context,
    ...additionalContext
  });
};

// ==================== ERROR HANDLER ====================

/**
 * Handle error and return user-friendly response
 */
export const handleError = (
  error: unknown,
  language: Language = 'arabic',
  context?: Record<string, unknown>
): { message: string; type: ErrorType } => {
  const botError = createBotError(error, context);
  logError(botError);

  return {
    message: getErrorMessage(botError.type, language),
    type: botError.type
  };
};

// ==================== RETRY LOGIC ====================

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableTypes: ErrorType[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  retryableTypes: ['rate_limit', 'timeout', 'api']
};

/**
 * Check if error is retryable
 */
export const isRetryable = (
  errorType: ErrorType,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): boolean => {
  return config.retryableTypes.includes(errorType);
};

/**
 * Calculate delay for retry with exponential backoff
 */
export const calculateRetryDelay = (
  attempt: number,
  errorType: ErrorType,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number => {
  // Longer delay for rate limit
  const multiplier = errorType === 'rate_limit' ? 5 : 1;
  const delay = config.baseDelayMs * Math.pow(2, attempt) * multiplier;
  return Math.min(delay, config.maxDelayMs);
};

/**
 * Execute function with retry logic
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> => {
  const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: unknown;

  for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const errorType = categorizeError(error);

      if (attempt === fullConfig.maxRetries || !isRetryable(errorType, fullConfig)) {
        throw error;
      }

      const delay = calculateRetryDelay(attempt, errorType, fullConfig);
      logger.warn(`Retrying after ${delay}ms (attempt ${attempt + 1}/${fullConfig.maxRetries})`, {
        errorType,
        delay
      });

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
};
