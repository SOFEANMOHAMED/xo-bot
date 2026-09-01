/** Format GPT token counts and USD cost for Super Admin surfaces. */

export function formatTokenCount(value: number | null | undefined): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return n.toLocaleString('en-US');
}

export function formatUsdCost(value: number | null | undefined): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export interface LlmUsageDisplay {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  tokensThisMonth: number;
  costUsdThisMonth: number;
  callCount: number;
}

export const EMPTY_LLM_USAGE_DISPLAY: LlmUsageDisplay = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  costUsd: 0,
  tokensThisMonth: 0,
  costUsdThisMonth: 0,
  callCount: 0,
};

export function normalizeLlmUsage(raw: unknown): LlmUsageDisplay {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_LLM_USAGE_DISPLAY };
  const u = raw as Record<string, unknown>;
  const num = (v: unknown) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    promptTokens: num(u.promptTokens),
    completionTokens: num(u.completionTokens),
    totalTokens: num(u.totalTokens),
    costUsd: num(u.costUsd),
    tokensThisMonth: num(u.tokensThisMonth),
    costUsdThisMonth: num(u.costUsdThisMonth),
    callCount: num(u.callCount),
  };
}
