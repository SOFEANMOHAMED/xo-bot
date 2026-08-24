/**
 * Core Module - Main exports
 * Entry point for the bot system
 */

// ==================== MAIN ORCHESTRATOR ====================
export {
  processMessage,
  getDefaultMerchantConfig
} from './orchestrator.js';

// ==================== TYPES ====================
export type {
  // Language & Localization
  Language,
  DetectedLanguage,

  // Intent & Stage
  Intent,
  Stage,
  Objection,
  CtaType,
  NextAction,
  RecommendationStrategy,

  // Platform & Persona
  Platform,
  Persona,

  // Entities & Config
  Entities,
  MerchantConfig,
  Message,
  ConversationState,

  // Request & Response
  IncomingMessage,
  BotResponse,

  // Product & Order
  Product,
  OrderData
} from './types.js';

export { MANDATORY_ORDER_FIELDS } from './types.js';

// ==================== ERROR HANDLER ====================
export {
  handleError,
  createBotError,
  logError,
  categorizeError,
  getErrorMessage,
  withRetry,
  isRetryable
} from './error-handler.js';

export type { ErrorType, BotError, RetryConfig } from './error-handler.js';
