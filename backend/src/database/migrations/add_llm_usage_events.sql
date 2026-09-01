-- Per-merchant LLM token ledger (GPT-4o mini). Safe to run multiple times.
-- Tenant isolation: merchant_id FK + ON DELETE CASCADE. Platform (official page / SaaS bots)
-- may store NULL merchant_id and is never mixed into a merchant's totals.

CREATE TABLE IF NOT EXISTS llm_usage_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  model VARCHAR(100) NOT NULL,
  purpose VARCHAR(50) NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  cached_prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(14, 8) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_events_merchant_created
  ON llm_usage_events (merchant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_usage_events_created
  ON llm_usage_events (created_at DESC);
