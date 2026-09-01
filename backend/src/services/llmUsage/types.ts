export const LLM_USAGE_PURPOSES = [
  'sales_chat',
  'product_description',
  'image_recognition',
  'saas_bot',
  'official_page',
] as const;

export type LlmUsagePurpose = (typeof LLM_USAGE_PURPOSES)[number];

export interface LlmUsageContextStore {
  merchantId?: string | null;
  purpose?: LlmUsagePurpose;
}

export interface RecordLlmUsageInput {
  merchantId?: string | null;
  model: string;
  purpose: LlmUsagePurpose;
  promptTokens: number;
  cachedPromptTokens?: number;
  completionTokens: number;
}

export interface MerchantLlmUsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  tokensThisMonth: number;
  costUsdThisMonth: number;
  callCount: number;
}

export interface AdminLlmUsageUserRow extends MerchantLlmUsageTotals {
  id: string;
  name: string;
  email: string;
}

export interface PlatformLlmUsageTotals extends MerchantLlmUsageTotals {
  costUsdAllTime: number;
  tokensAllTime: number;
}

export const EMPTY_MERCHANT_LLM_USAGE: MerchantLlmUsageTotals = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  costUsd: 0,
  tokensThisMonth: 0,
  costUsdThisMonth: 0,
  callCount: 0,
};
