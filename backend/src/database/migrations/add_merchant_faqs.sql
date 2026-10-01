-- Merchant FAQs: canned Q&A answered verbatim when a customer turn matches semantically.
-- Multi-tenant: every row is scoped by merchant_id.

CREATE TABLE IF NOT EXISTS merchant_faqs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_merchant_faqs_lookup
  ON merchant_faqs(merchant_id, is_active, priority DESC);
