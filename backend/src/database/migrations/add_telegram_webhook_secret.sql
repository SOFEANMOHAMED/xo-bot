-- Migration: Add telegram_webhook_secret to merchant_settings
-- This allows each merchant to have a unique webhook secret for SaaS multi-tenant support

-- Add telegram_webhook_secret column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'merchant_settings' AND column_name = 'telegram_webhook_secret'
    ) THEN
        ALTER TABLE merchant_settings 
        ADD COLUMN telegram_webhook_secret VARCHAR(255) UNIQUE;
        
        -- Create index for faster lookups
        CREATE INDEX IF NOT EXISTS idx_merchant_settings_telegram_webhook_secret 
        ON merchant_settings(telegram_webhook_secret);
        
        RAISE NOTICE 'Column telegram_webhook_secret added successfully';
    ELSE
        RAISE NOTICE 'Column telegram_webhook_secret already exists';
    END IF;
END $$;

