/**
 * AI Module - OpenAI client and prompt building
 */

// ==================== OPENAI CLIENT ====================
export {
  getAIClient,
  isAIAvailable,
  generateContent,
  generateSimple,
  generateJSON,
  trackAICall,
  getAICallsCount,
  resetAICallsCount,
  getTimeSinceReset
} from './gemini-client.js';

export type {
  GenerateOptions,
  GenerateResult,
  ChatMessage
} from './gemini-client.js';

// ==================== PROMPT BUILDER ====================
export {
  buildSalesPrompt,
  buildIntentDetectionPrompt,
  buildObjectionPrompt
} from './prompt-builder.js';

export type {
  PromptContext,
  ObjectionPromptContext
} from './prompt-builder.js';
