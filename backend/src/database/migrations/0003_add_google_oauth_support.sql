-- Migration: Add Google OAuth support
-- Adds google_id and auth_provider columns to merchants table

DO $$
BEGIN
    -- Add google_id column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'merchants' AND column_name = 'google_id'
    ) THEN
        ALTER TABLE merchants
        ADD COLUMN google_id VARCHAR(255) UNIQUE;
        
        -- Create index for faster lookups
        CREATE INDEX IF NOT EXISTS idx_merchants_google_id ON merchants(google_id);
    END IF;

    -- Add auth_provider column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'merchants' AND column_name = 'auth_provider'
    ) THEN
        ALTER TABLE merchants
        ADD COLUMN auth_provider VARCHAR(50) DEFAULT 'email';
        
        -- Update existing rows to have 'email' as default
        UPDATE merchants
        SET auth_provider = 'email'
        WHERE auth_provider IS NULL;
        
        -- Set NOT NULL constraint
        ALTER TABLE merchants
        ALTER COLUMN auth_provider SET NOT NULL;
    END IF;
END $$;

-- Verification queries (commented out - uncomment to verify)
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'merchants' AND column_name IN ('google_id', 'auth_provider');

