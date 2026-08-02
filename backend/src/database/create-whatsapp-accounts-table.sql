-- Create WhatsApp Accounts Table
CREATE TABLE IF NOT EXISTS whatsapp_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    phone_number_id VARCHAR(255) NOT NULL,
    phone_number VARCHAR(50) NOT NULL,
    business_account_id VARCHAR(255),
    access_token TEXT NOT NULL,
    app_id VARCHAR(255),
    app_secret VARCHAR(255),
    webhook_verify_token VARCHAR(255),
    auto_reply_enabled BOOLEAN DEFAULT false,
    welcome_message TEXT,
    last_sync TIMESTAMP,
    is_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(merchant_id, phone_number_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_whatsapp_accounts_merchant_id ON whatsapp_accounts(merchant_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_accounts_phone_number_id ON whatsapp_accounts(phone_number_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_accounts_is_verified ON whatsapp_accounts(is_verified);

-- Add comment
COMMENT ON TABLE whatsapp_accounts IS 'WhatsApp Business API accounts connected by merchants';

