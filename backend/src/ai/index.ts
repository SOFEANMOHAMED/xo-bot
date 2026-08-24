/**
 * AI Module - OpenAI client
 */

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
