import pool from '../../database/connection.js';
import { GPT_4O_MINI_RATES, LLM_MODEL_GPT_4O_MINI } from './pricing.js';
import { ensureLlmUsageSchema } from './schema.js';
import {
  EMPTY_MERCHANT_LLM_USAGE,
  type AdminLlmUsageUserRow,
  type MerchantLlmUsageTotals,
} from './types.js';

function toInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toUsd(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1e8) / 1e8;
}

function rowToTotals(row: Record<string, unknown> | undefined): MerchantLlmUsageTotals {
  if (!row) return { ...EMPTY_MERCHANT_LLM_USAGE };
  return {
    promptTokens: toInt(row.prompt_tokens),
    completionTokens: toInt(row.completion_tokens),
    totalTokens: toInt(row.total_tokens),
    costUsd: toUsd(row.cost_usd),
    tokensThisMonth: toInt(row.tokens_this_month),
    costUsdThisMonth: toUsd(row.cost_usd_this_month),
    callCount: toInt(row.call_count),
  };
}

const MERCHANT_AGG_SELECT = `
  COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
  COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
  COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
  COALESCE(SUM(cost_usd), 0)::numeric AS cost_usd,
  COALESCE(SUM(total_tokens) FILTER (
    WHERE created_at >= date_trunc('month', CURRENT_TIMESTAMP)
  ), 0)::bigint AS tokens_this_month,
  COALESCE(SUM(cost_usd) FILTER (
    WHERE created_at >= date_trunc('month', CURRENT_TIMESTAMP)
  ), 0)::numeric AS cost_usd_this_month,
  COUNT(*)::int AS call_count
`;

export async function getMerchantLlmUsageTotals(
  merchantId: string
): Promise<MerchantLlmUsageTotals> {
  await ensureLlmUsageSchema();
  const result = await pool.query(
    `SELECT ${MERCHANT_AGG_SELECT}
     FROM llm_usage_events
     WHERE merchant_id = $1`,
    [merchantId]
  );
  return rowToTotals(result.rows[0]);
}

export async function getLlmUsageTotalsByMerchantIds(
  merchantIds: string[]
): Promise<Map<string, MerchantLlmUsageTotals>> {
  const map = new Map<string, MerchantLlmUsageTotals>();
  if (merchantIds.length === 0) return map;

  await ensureLlmUsageSchema();
  const result = await pool.query(
    `SELECT merchant_id, ${MERCHANT_AGG_SELECT}
     FROM llm_usage_events
     WHERE merchant_id = ANY($1::uuid[])
     GROUP BY merchant_id`,
    [merchantIds]
  );

  for (const row of result.rows) {
    map.set(String(row.merchant_id), rowToTotals(row));
  }
  return map;
}

export async function getPlatformLlmUsageTotals(): Promise<{
  merchants: MerchantLlmUsageTotals;
  platform: MerchantLlmUsageTotals;
}> {
  await ensureLlmUsageSchema();
  const result = await pool.query(
    `SELECT
       CASE WHEN merchant_id IS NULL THEN 'platform' ELSE 'merchants' END AS bucket,
       ${MERCHANT_AGG_SELECT}
     FROM llm_usage_events
     GROUP BY CASE WHEN merchant_id IS NULL THEN 'platform' ELSE 'merchants' END`
  );

  let merchants = { ...EMPTY_MERCHANT_LLM_USAGE };
  let platform = { ...EMPTY_MERCHANT_LLM_USAGE };
  for (const row of result.rows) {
    const totals = rowToTotals(row);
    if (row.bucket === 'platform') platform = totals;
    else merchants = totals;
  }
  return { merchants, platform };
}

export async function getAdminLlmUsageByUser(): Promise<AdminLlmUsageUserRow[]> {
  await ensureLlmUsageSchema();
  const result = await pool.query(
    `SELECT
       m.id,
       m.name,
       m.email,
       COALESCE(u.prompt_tokens, 0)::bigint AS prompt_tokens,
       COALESCE(u.completion_tokens, 0)::bigint AS completion_tokens,
       COALESCE(u.total_tokens, 0)::bigint AS total_tokens,
       COALESCE(u.cost_usd, 0)::numeric AS cost_usd,
       COALESCE(u.tokens_this_month, 0)::bigint AS tokens_this_month,
       COALESCE(u.cost_usd_this_month, 0)::numeric AS cost_usd_this_month,
       COALESCE(u.call_count, 0)::int AS call_count
     FROM merchants m
     LEFT JOIN (
       SELECT merchant_id, ${MERCHANT_AGG_SELECT}
       FROM llm_usage_events
       WHERE merchant_id IS NOT NULL
       GROUP BY merchant_id
     ) u ON u.merchant_id = m.id
     WHERE (m.role NOT IN ('owner', 'admin') OR m.role IS NULL)
     ORDER BY COALESCE(u.cost_usd, 0) DESC, COALESCE(u.total_tokens, 0) DESC, m.created_at DESC`
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    name: row.name || row.email || 'مستخدم غير معروف',
    email: String(row.email || ''),
    ...rowToTotals(row),
  }));
}

export function getPublicPricingSnapshot() {
  return {
    model: LLM_MODEL_GPT_4O_MINI,
    inputPer1MUsd: GPT_4O_MINI_RATES.inputPerMillionUsd,
    cachedInputPer1MUsd: GPT_4O_MINI_RATES.cachedInputPerMillionUsd,
    outputPer1MUsd: GPT_4O_MINI_RATES.outputPerMillionUsd,
  };
}
