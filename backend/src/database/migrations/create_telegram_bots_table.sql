-- Migration: Create telegram_bots table for multiple Telegram bots support
-- This allows merchants to connect multiple Telegram bots based on their plan

-- Create telegram_bots table
CREATE TABLE IF NOT EXISTS telegram_bots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    bot_token TEXT NOT NULL,
    webhook_secret VARCHAR(255) UNIQUE NOT NULL,
    bot_name VARCHAR(255),
    bot_username VARCHAR(255),
    bot_type VARCHAR(50) NOT NULL DEFAULT 'both', -- 'products', 'services', 'both'
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_telegram_bots_merchant_id ON telegram_bots(merchant_id);
CREATE INDEX IF NOT EXISTS idx_telegram_bots_webhook_secret ON telegram_bots(webhook_secret);
CREATE INDEX IF NOT EXISTS idx_telegram_bots_is_active ON telegram_bots(is_active);

-- Note: Migration of existing bots is handled by Node.js script
-- This SQL only creates the table structure

