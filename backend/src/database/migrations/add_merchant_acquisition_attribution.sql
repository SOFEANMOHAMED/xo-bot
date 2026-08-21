-- Merchant SaaS acquisition attribution (ads / UTM / official Messenger)
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_source VARCHAR(64);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_medium VARCHAR(64);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_campaign VARCHAR(128);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_content VARCHAR(128);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_term VARCHAR(128);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_ad_id VARCHAR(128);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_ref VARCHAR(128);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_acq_code VARCHAR(32);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_landing_path TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_platform_conversation_id UUID;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_first_touch_at TIMESTAMP;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_raw JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_merchants_acquisition_campaign
  ON merchants(acquisition_campaign) WHERE acquisition_campaign IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_merchants_acquisition_source
  ON merchants(acquisition_source) WHERE acquisition_source IS NOT NULL;

ALTER TABLE platform_conversations ADD COLUMN IF NOT EXISTS acq_code VARCHAR(32);
ALTER TABLE platform_conversations
  ADD COLUMN IF NOT EXISTS attributed_merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_conversations_acq_code
  ON platform_conversations(acq_code) WHERE acq_code IS NOT NULL;
