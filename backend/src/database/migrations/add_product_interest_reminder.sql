-- Product-interest reminder settings (SaaS per-merchant)
-- Safe to run multiple times

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'merchant_settings'
      AND column_name = 'product_interest_reminder_enabled'
  ) THEN
    ALTER TABLE merchant_settings
      ADD COLUMN product_interest_reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'merchant_settings'
      AND column_name = 'product_interest_reminder_delay_minutes'
  ) THEN
    ALTER TABLE merchant_settings
      ADD COLUMN product_interest_reminder_delay_minutes INTEGER NOT NULL DEFAULT 60;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'merchant_settings'
      AND column_name = 'product_interest_reminder_message'
  ) THEN
    ALTER TABLE merchant_settings
      ADD COLUMN product_interest_reminder_message TEXT;
  END IF;
END $$;

UPDATE merchant_settings
SET product_interest_reminder_delay_minutes = 60
WHERE product_interest_reminder_delay_minutes IS NULL
   OR product_interest_reminder_delay_minutes < 5
   OR product_interest_reminder_delay_minutes > 720;

COMMENT ON COLUMN merchant_settings.product_interest_reminder_enabled IS
  'Send a product-benefits reminder after an explicit product question then silence';
COMMENT ON COLUMN merchant_settings.product_interest_reminder_delay_minutes IS
  'Minutes of customer silence before a product-interest reminder (default 60)';
COMMENT ON COLUMN merchant_settings.product_interest_reminder_message IS
  'Optional template; supports {name}, {product}, {benefits}, {benefits_block}, {price}';

-- Allow product_interest_reminder as a message source
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'messages'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%source%'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE messages DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE messages
    ADD CONSTRAINT messages_source_check
    CHECK (source IS NULL OR source IN (
      'webhook',
      'api',
      'facebook_inbox',
      'whatsapp_manager',
      'telegram',
      'whatsapp',
      'facebook_messenger',
      'instagram',
      'abandoned_reminder',
      'product_interest_reminder'
    ));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
