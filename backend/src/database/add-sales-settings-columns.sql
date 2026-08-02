-- Add sales optimization columns to merchant_settings table
DO $$
BEGIN
    -- Add enable_cross_selling column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'merchant_settings' AND column_name = 'enable_cross_selling'
    ) THEN
        ALTER TABLE merchant_settings ADD COLUMN enable_cross_selling BOOLEAN DEFAULT true;
    END IF;

    -- Add enable_upselling column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'merchant_settings' AND column_name = 'enable_upselling'
    ) THEN
        ALTER TABLE merchant_settings ADD COLUMN enable_upselling BOOLEAN DEFAULT true;
    END IF;

    -- Add enable_urgency_messages column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'merchant_settings' AND column_name = 'enable_urgency_messages'
    ) THEN
        ALTER TABLE merchant_settings ADD COLUMN enable_urgency_messages BOOLEAN DEFAULT true;
    END IF;

    -- Add enable_social_proof column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'merchant_settings' AND column_name = 'enable_social_proof'
    ) THEN
        ALTER TABLE merchant_settings ADD COLUMN enable_social_proof BOOLEAN DEFAULT true;
    END IF;

    -- Add default_discount_percentage column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'merchant_settings' AND column_name = 'default_discount_percentage'
    ) THEN
        ALTER TABLE merchant_settings ADD COLUMN default_discount_percentage INTEGER DEFAULT 10;
    END IF;

    -- Add sales_scripts column (JSONB)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'merchant_settings' AND column_name = 'sales_scripts'
    ) THEN
        ALTER TABLE merchant_settings ADD COLUMN sales_scripts JSONB DEFAULT '{}'::jsonb;
    END IF;
END $$;

