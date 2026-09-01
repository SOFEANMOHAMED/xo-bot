import pool from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import { calculateUsdCost, LLM_MODEL_GPT_4O_MINI } from './pricing.js';
import { getLlmUsageContext } from './context.js';
import { ensureLlmUsageSchema } from './schema.js';
import type { LlmUsagePurpose, RecordLlmUsageInput } from './types.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sanitizeTokenCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function sanitizeMerchantId(merchantId: string | null | undefined): string | null {
  if (!merchantId || typeof merchantId !== 'string') return null;
  const trimmed = merchantId.trim();
  return UUID_RE.test(trimmed) ? trimmed : null;
}

/**
 * Persist one billed completion. Fire-and-forget from callers so chat latency
 * is never blocked on the ledger write.
 */
export async function recordLlmUsage(input: RecordLlmUsageInput): Promise<void> {
  const promptTokens = sanitizeTokenCount(input.promptTokens);
  const cachedPromptTokens = sanitizeTokenCount(input.cachedPromptTokens);
  const completionTokens = sanitizeTokenCount(input.completionTokens);
  const totalTokens = promptTokens + completionTokens;

  if (totalTokens <= 0) return;

  const merchantId = sanitizeMerchantId(input.merchantId);
  const model = (input.model || LLM_MODEL_GPT_4O_MINI).slice(0, 100);
  const costUsd = calculateUsdCost(
    { promptTokens, cachedPromptTokens, completionTokens, totalTokens },
    model
  );

  try {
    await ensureLlmUsageSchema();
    await pool.query(
      `INSERT INTO llm_usage_events (
         merchant_id, model, purpose,
         prompt_tokens, cached_prompt_tokens, completion_tokens, total_tokens, cost_usd
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        merchantId,
        model,
        input.purpose,
        promptTokens,
        cachedPromptTokens,
        completionTokens,
        totalTokens,
        costUsd,
      ]
    );
  } catch (error) {
    logger.warn('Failed to record LLM usage event', {
      merchantId,
      model,
      purpose: input.purpose,
      promptTokens,
      completionTokens,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function recordLlmUsageBackground(input: RecordLlmUsageInput): void {
  void recordLlmUsage(input);
}

type OpenAiUsageLike = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
} | null | undefined;

/**
 * Record usage returned by OpenAI chat.completions. Merchant/purpose come from
 * explicit args, then AsyncLocalStorage (SalesGPT request), else platform-level.
 */
export function recordOpenAIUsage(
  usage: OpenAiUsageLike,
  options: {
    merchantId?: string | null;
    purpose?: LlmUsagePurpose;
    model?: string;
  } = {}
): void {
  if (!usage) return;

  const ctx = getLlmUsageContext();
  const promptTokens = sanitizeTokenCount(usage.prompt_tokens);
  const completionTokens = sanitizeTokenCount(usage.completion_tokens);
  const cachedPromptTokens = sanitizeTokenCount(usage.prompt_tokens_details?.cached_tokens);

  recordLlmUsageBackground({
    merchantId: options.merchantId !== undefined ? options.merchantId : ctx?.merchantId,
    purpose: options.purpose ?? ctx?.purpose ?? 'sales_chat',
    model: options.model ?? LLM_MODEL_GPT_4O_MINI,
    promptTokens,
    cachedPromptTokens,
    completionTokens,
  });
}
