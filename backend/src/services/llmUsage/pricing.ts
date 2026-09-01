/**
 * Official OpenAI list prices for models we actually call.
 * Update here when OpenAI publishes a rate change — Super Admin cost
 * is derived only from this table + recorded token counts.
 *
 * gpt-4o-mini (standard, non-batch) as of 2026-08:
 *   input $0.15 / 1M, cached input $0.075 / 1M, output $0.60 / 1M
 */

export const LLM_MODEL_GPT_4O_MINI = 'gpt-4o-mini';

export interface ModelTokenRates {
  inputPerMillionUsd: number;
  cachedInputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

export const GPT_4O_MINI_RATES: ModelTokenRates = {
  inputPerMillionUsd: 0.15,
  cachedInputPerMillionUsd: 0.075,
  outputPerMillionUsd: 0.6,
};

const RATES_BY_MODEL: Record<string, ModelTokenRates> = {
  [LLM_MODEL_GPT_4O_MINI]: GPT_4O_MINI_RATES,
};

export function getModelRates(model: string): ModelTokenRates {
  const key = model.trim().toLowerCase();
  return RATES_BY_MODEL[key] ?? GPT_4O_MINI_RATES;
}

export interface TokenUsageBreakdown {
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Dollar cost for a single completion. Cached prompt tokens are billed
 * at the cached-input rate; remaining prompt tokens at the input rate.
 */
export function calculateUsdCost(
  usage: TokenUsageBreakdown,
  model: string = LLM_MODEL_GPT_4O_MINI
): number {
  const rates = getModelRates(model);
  const cached = Math.max(0, Math.min(usage.cachedPromptTokens, usage.promptTokens));
  const uncachedPrompt = Math.max(0, usage.promptTokens - cached);
  const raw =
    (uncachedPrompt * rates.inputPerMillionUsd +
      cached * rates.cachedInputPerMillionUsd +
      usage.completionTokens * rates.outputPerMillionUsd) /
    1_000_000;
  // 8 decimal places matches NUMERIC(14, 8) and avoids float noise in sums.
  return Math.round(raw * 1e8) / 1e8;
}
