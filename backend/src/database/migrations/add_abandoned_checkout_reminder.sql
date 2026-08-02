-- Abandoned checkout reminder settings (SaaS per-merchant)
-- Safe to run multiple times

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'merchant_settings'
      AND column_name = 'abandoned_reminder_enabled'
  ) THEN
    ALTER TABLE merchant_settings
      ADD COLUMN abandoned_reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'merchant_settings'
      AND column_name = 'abandoned_reminder_delay_minutes'
  ) THEN
    ALTER TABLE merchant_settings
      ADD COLUMN abandoned_reminder_delay_minutes INTEGER NOT NULL DEFAULT 45;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'merchant_settings'
      AND column_name = 'abandoned_reminder_message'
  ) THEN
    ALTER TABLE merchant_settings
      ADD COLUMN abandoned_reminder_message TEXT;
  END IF;
END $$;

-- Clamp delay to a sane range for existing rows
UPDATE merchant_settings
SET abandoned_reminder_delay_minutes = 45
WHERE abandoned_reminder_delay_minutes IS NULL
   OR abandoned_reminder_delay_minutes < 5
   OR abandoned_reminder_delay_minutes > 720;

COMMENT ON COLUMN merchant_settings.abandoned_reminder_enabled IS
  'Send a gentle reminder when a customer abandons checkout mid-flow';
COMMENT ON COLUMN merchant_settings.abandoned_reminder_delay_minutes IS
  'Minutes of customer silence before the first abandoned-checkout reminder';
COMMENT ON COLUMN merchant_settings.abandoned_reminder_message IS
  'Optional custom template; supports {name}, {product}, {product_clause}';

-- Allow abandoned_reminder as a message source (drop legacy check if present)
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
      'abandoned_reminder'
    ));
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;

-- Helpful for scanning active bot conversations (tenant-scoped queries still filter merchant_id)
CREATE INDEX IF NOT EXISTS idx_conversations_checkout_reminder
  ON conversations (merchant_id, platform, last_message_at DESC)
  WHERE COALESCE(bot_disabled, false) = false;
