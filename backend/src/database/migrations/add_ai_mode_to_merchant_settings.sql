-- Add ai_mode column to merchant_settings for hybrid/full AI mode
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'merchant_settings' AND column_name = 'ai_mode'
    ) THEN
        ALTER TABLE merchant_settings ADD COLUMN ai_mode VARCHAR(20) DEFAULT 'hybrid';
    END IF;
END $$;
