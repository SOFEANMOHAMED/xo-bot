/**
 * Real OpenAI bridge for test-live (catalog still stubbed via harness).
 * Loaded through liveHooks resolve; keys never logged.
 */
import OpenAI from 'openai';
import { harness } from '../test_pipeline_harness_state.js';
import { liveBudget } from './liveBudget.js';

const API_KEY = process.env.OPENAI_API_KEY || '';
const DEFAULT_MODEL = process.env.LIVE_LLM_MODEL || 'gpt-4o-mini';

let client: OpenAI | null = null;
let aiCalls = 0;

function getClient(): OpenAI | null {
  if (!API_KEY) return null;
  if (!client) {
    client = new OpenAI({ apiKey: API_KEY });
  }
  return client;
}

export const isAIAvailable = (): boolean => Boolean(API_KEY);
export const getAIClient = (): OpenAI | null => getClient();
export const trackAICall = (): void => {
  aiCalls += 1;
};
export const getAICallsCount = (): number => aiCalls;
export const resetAICallsCount = (): void => {
  aiCalls = 0;
};

type ChatPart = { text?: string };
type ChatMsg = { role?: string; parts?: ChatPart[] };

export type GenerateOptions = {
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
};

export type GenerateResult = {
  text: string;
  success: boolean;
  error?: string;
  metadata?: { model: string; tokenCount?: number; latencyMs: number };
};

export async function generateContent(
  contents: ChatMsg[],
  options: GenerateOptions = {}
): Promise<GenerateResult> {
  liveBudget.beforeCall();
  const start = Date.now();
  const c = getClient();
  if (!c) {
    return {
      text: '',
      success: false,
      error: 'AI client not available',
      metadata: { model: DEFAULT_MODEL, latencyMs: 0 },
    };
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (options.systemInstruction) {
    messages.push({ role: 'system', content: options.systemInstruction });
  }
  for (const msg of contents || []) {
    const role = msg.role === 'model' ? 'assistant' : 'user';
    const text = (msg.parts || []).map((p) => p.text || '').join('');
    messages.push({ role, content: text });
  }

  try {
    const completion = await c.chat.completions.create({
      model: DEFAULT_MODEL,
      messages,
      temperature: options.temperature ?? 0.4,
      max_tokens: options.maxOutputTokens ?? 800,
    });
    const text = completion.choices?.[0]?.message?.content || '';
    liveBudget.afterCall(completion.usage ?? undefined);
    trackAICall();
    return {
      text,
      success: true,
      metadata: {
        model: DEFAULT_MODEL,
        tokenCount: completion.usage?.total_tokens || 0,
        latencyMs: Date.now() - start,
      },
    };
  } catch (error) {
    liveBudget.afterCall();
    return {
      text: '',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      metadata: { model: DEFAULT_MODEL, latencyMs: Date.now() - start },
    };
  }
}

export async function generateSimple(
  prompt: string,
  options: GenerateOptions = {}
): Promise<GenerateResult> {
  return generateContent([{ role: 'user', parts: [{ text: prompt }] }], options);
}

export async function generateJSON<T = unknown>(
  prompt: string,
  options: GenerateOptions = {}
): Promise<{ data: T | null; success: boolean; error?: string }> {
  harness.calls.generateJSON += 1;
  harness.lastGeneratePrompt = prompt;
  const result = await generateSimple(prompt, { ...options, temperature: 0.1 });
  if (!result.success) {
    return { data: null, success: false, error: result.error };
  }
  try {
    let jsonText = result.text || '';
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    return { data: JSON.parse(jsonText) as T, success: true };
  } catch {
    return { data: null, success: false, error: 'Failed to parse JSON response' };
  }
}
