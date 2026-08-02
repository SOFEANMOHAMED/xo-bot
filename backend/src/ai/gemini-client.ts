/**
 * OpenAI Client - Centralized AI service client
 * Single point of AI interaction with retry logic
 */

import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import { withRetry, categorizeError } from '../core/error-handler.js';

// ==================== CONFIGURATION ====================

const API_KEY = process.env.OPENAI_API_KEY || '';
const DEFAULT_MODEL = 'gpt-4o-mini';

// AI Client singleton
let aiClient: OpenAI | null = null;

// ==================== TYPES ====================

export interface GenerateOptions {
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
}

export interface GenerateResult {
  text: string;
  success: boolean;
  error?: string;
  metadata?: {
    model: string;
    tokenCount?: number;
    latencyMs: number;
  };
}

export interface ChatMessage {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

// ==================== CLIENT MANAGEMENT ====================

/**
 * Get or create OpenAI client
 */
export const getAIClient = (): OpenAI | null => {
  if (!API_KEY) {
    logger.warn('OpenAI API key not configured');
    return null;
  }

  if (!aiClient) {
    aiClient = new OpenAI({ apiKey: API_KEY });
  }

  return aiClient;
};

/**
 * Check if AI is available
 */
export const isAIAvailable = (): boolean => {
  return !!API_KEY;
};

// ==================== GENERATION ====================

/**
 * Generate content using OpenAI
 * Uses retry logic for rate limits and transient errors
 */
export const generateContent = async (
  contents: ChatMessage[],
  options: GenerateOptions = {}
): Promise<GenerateResult> => {
  const startTime = Date.now();
  const client = getAIClient();

  if (!client) {
    return {
      text: '',
      success: false,
      error: 'AI client not available',
      metadata: {
        model: DEFAULT_MODEL,
        latencyMs: Date.now() - startTime
      }
    };
  }

  const {
    systemInstruction,
    temperature = 0.3,
    maxOutputTokens = 300,
    topP = 0.9
  } = options;

  try {
    const result = await withRetry(async () => {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

      if (systemInstruction) {
        messages.push({ role: 'system', content: systemInstruction });
      }

      for (const content of contents) {
        const role = content.role === 'model' ? 'assistant' : 'user';
        const text = content.parts.map((part) => part.text).join('');
        messages.push({ role, content: text });
      }

      return client.chat.completions.create({
        model: DEFAULT_MODEL,
        messages,
        temperature,
        max_tokens: maxOutputTokens,
        top_p: topP
      });
    }, {
      maxRetries: 2,
      baseDelayMs: 1000
    });

    const text = result?.choices?.[0]?.message?.content?.trim() || '';

    logger.info('AI generation completed', {
      model: DEFAULT_MODEL,
      latencyMs: Date.now() - startTime,
      responseLength: text.length,
      generatedText: text
    });

    return {
      text,
      success: true,
      metadata: {
        model: DEFAULT_MODEL,
        tokenCount: result?.usage?.total_tokens,
        latencyMs: Date.now() - startTime
      }
    };
  } catch (error) {
    const errorType = categorizeError(error);
    
    logger.error('AI generation failed', error as Error, {
      model: DEFAULT_MODEL,
      errorType,
      latencyMs: Date.now() - startTime
    });

    return {
      text: '',
      success: false,
      error: (error as Error).message,
      metadata: {
        model: DEFAULT_MODEL,
        latencyMs: Date.now() - startTime
      }
    };
  }
};

/**
 * Generate simple text response (single message, no chat history)
 */
export const generateSimple = async (
  prompt: string,
  options: GenerateOptions = {}
): Promise<GenerateResult> => {
  const contents: ChatMessage[] = [
    {
      role: 'user',
      parts: [{ text: prompt }]
    }
  ];

  return generateContent(contents, options);
};

/**
 * Generate JSON response with parsing
 */
export const generateJSON = async <T = unknown>(
  prompt: string,
  options: GenerateOptions = {}
): Promise<{ data: T | null; success: boolean; error?: string }> => {
  const result = await generateSimple(prompt, {
    ...options,
    temperature: 0.1 // Lower temperature for JSON
  });

  if (!result.success) {
    return {
      data: null,
      success: false,
      error: result.error
    };
  }

  try {
    // Clean up JSON from markdown
    let jsonText = result.text;
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const data = JSON.parse(jsonText) as T;
    return { data, success: true };
  } catch (parseError) {
    logger.error('Failed to parse AI JSON response', parseError as Error, {
      responsePreview: result.text.substring(0, 200)
    });

    return {
      data: null,
      success: false,
      error: 'Failed to parse JSON response'
    };
  }
};

// ==================== USAGE TRACKING ====================

// Track AI calls for cost optimization
let aiCallsCount = 0;
let lastResetTime = Date.now();

/**
 * Increment AI calls counter
 */
export const trackAICall = (): void => {
  aiCallsCount++;
};

/**
 * Get AI calls count since last reset
 */
export const getAICallsCount = (): number => {
  return aiCallsCount;
};

/**
 * Reset AI calls counter
 */
export const resetAICallsCount = (): void => {
  aiCallsCount = 0;
  lastResetTime = Date.now();
};

/**
 * Get time since last reset
 */
export const getTimeSinceReset = (): number => {
  return Date.now() - lastResetTime;
};
