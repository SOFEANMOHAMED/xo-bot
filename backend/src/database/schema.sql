-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Merchants Table
CREATE TABLE IF NOT EXISTS merchants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    name VARCHAR(255),
    phone VARCHAR(20),
    google_id VARCHAR(255) UNIQUE,
    auth_provider VARCHAR(50) DEFAULT 'email',
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('owner', 'admin', 'user')),
    subscription_plan VARCHAR(50) DEFAULT 'trial',
    subscription_status VARCHAR(50) DEFAULT 'active',
    trial_ends_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add missing columns to merchants table if they don't exist
DO $$ 
BEGIN
    -- Add role column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'merchants' AND column_name = 'role'
    ) THEN
        ALTER TABLE merchants ADD COLUMN role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('owner', 'admin', 'user'));
    END IF;
    
    -- Add phone column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'merchants' AND column_name = 'phone'
    ) THEN
        ALTER TABLE merchants ADD COLUMN phone VARCHAR(20);
    END IF;
    
    -- Add subscription_status column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'merchants' AND column_name = 'subscription_status'
    ) THEN
        ALTER TABLE merchants ADD COLUMN subscription_status VARCHAR(50) DEFAULT 'active';
    END IF;
    
    -- Add trial_ends_at column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'merchants' AND column_name = 'trial_ends_at'
    ) THEN
        ALTER TABLE merchants ADD COLUMN trial_ends_at TIMESTAMP;
    END IF;
    
    -- Add google_id column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'merchants' AND column_name = 'google_id'
    ) THEN
        ALTER TABLE merchants ADD COLUMN google_id VARCHAR(255) UNIQUE;
    END IF;
    
    -- Add auth_provider column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'merchants' AND column_name = 'auth_provider'
    ) THEN
        ALTER TABLE merchants ADD COLUMN auth_provider VARCHAR(50) DEFAULT 'email';
        UPDATE merchants SET auth_provider = 'email' WHERE auth_provider IS NULL;
        ALTER TABLE merchants ALTER COLUMN auth_provider SET NOT NULL;
    END IF;
END $$;

-- Create index for role
CREATE INDEX IF NOT EXISTS idx_merchants_role ON merchants(role);

-- Create index for google_id
CREATE INDEX IF NOT EXISTS idx_merchants_google_id ON merchants(google_id);

-- Merchant lifecycle emails (welcome, onboarding, trial nudges)
CREATE TABLE IF NOT EXISTS merchant_lifecycle_emails (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    email_type VARCHAR(50) NOT NULL,
    sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (merchant_id, email_type)
);
CREATE INDEX IF NOT EXISTS idx_merchant_lifecycle_emails_type_sent
    ON merchant_lifecycle_emails (email_type, sent_at DESC);

-- Products Table
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    external_id VARCHAR(255),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    category VARCHAR(255),
    stock INTEGER DEFAULT 0,
    sizes TEXT[],
    colors TEXT[],
    image_url TEXT,
    source VARCHAR(50) DEFAULT 'manual',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add colors column to products table if it doesn't exist (for existing installations)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'products' AND column_name = 'colors'
    ) THEN
        ALTER TABLE products
        ADD COLUMN colors TEXT[];
    END IF;
END $$;

-- Services Table
CREATE TABLE IF NOT EXISTS services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(255),
    type VARCHAR(100),
    short_description TEXT,
    full_description TEXT,
    price_label VARCHAR(100),
    pricing_type VARCHAR(50),
    duration VARCHAR(100),
    delivery_time VARCHAR(100),
    included_items TEXT[],
    requirements TEXT[],
    previous_work_templates TEXT[],
    booking_link TEXT,
    contact_channel VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Telegram Bots Table (Multiple bots support)
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

-- Indexes for telegram_bots
CREATE INDEX IF NOT EXISTS idx_telegram_bots_merchant_id ON telegram_bots(merchant_id);
CREATE INDEX IF NOT EXISTS idx_telegram_bots_webhook_secret ON telegram_bots(webhook_secret);
CREATE INDEX IF NOT EXISTS idx_telegram_bots_is_active ON telegram_bots(is_active);

-- Orders Table
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    external_id VARCHAR(255),
    customer_name VARCHAR(255) NOT NULL,
    customer_email VARCHAR(255),
    customer_phone VARCHAR(50),
    customer_address TEXT,
    delivery_time VARCHAR(255),
    total DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    status VARCHAR(50) DEFAULT 'pending',
    source VARCHAR(50) DEFAULT 'manual',
    notes TEXT,
    viewed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Order Items Table
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    product_name VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    price DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Settings Table
CREATE TABLE IF NOT EXISTS merchant_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID UNIQUE NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    store_name VARCHAR(255),
    telegram_bot_token TEXT,
    telegram_webhook_secret VARCHAR(255) UNIQUE,
    welcome_message TEXT,
    system_prompt TEXT,
    auto_reply_comments BOOLEAN DEFAULT false,
    auto_reply_messenger BOOLEAN DEFAULT false,
    store_currency VARCHAR(10) DEFAULT 'USD',
    bot_persona VARCHAR(50) DEFAULT 'friendly',
    ai_mode VARCHAR(20) DEFAULT 'hybrid',
    shipping_policy TEXT,
    delivery_time VARCHAR(255),
    payment_methods TEXT,
    return_policy TEXT,
    additional_notes TEXT,
    enable_ai_injection BOOLEAN DEFAULT false,
    abandoned_reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    abandoned_reminder_delay_minutes INTEGER NOT NULL DEFAULT 45,
    abandoned_reminder_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add telegram_webhook_secret column if it doesn't exist (for existing installations)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'merchant_settings' AND column_name = 'telegram_webhook_secret'
    ) THEN
        ALTER TABLE merchant_settings 
        ADD COLUMN telegram_webhook_secret VARCHAR(255) UNIQUE;
        
        CREATE INDEX IF NOT EXISTS idx_merchant_settings_telegram_webhook_secret 
        ON merchant_settings(telegram_webhook_secret);
    END IF;
END $$;

-- Add ai_mode column to merchant_settings if it doesn't exist (for existing installations)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'merchant_settings' AND column_name = 'ai_mode'
    ) THEN
        ALTER TABLE merchant_settings 
        ADD COLUMN ai_mode VARCHAR(20) DEFAULT 'hybrid';
    END IF;
END $$;

-- Add viewed_at column to orders table if it doesn't exist (for existing installations)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'orders' AND column_name = 'viewed_at'
    ) THEN
        ALTER TABLE orders 
        ADD COLUMN viewed_at TIMESTAMP;
    END IF;
END $$;

-- Add delivery_time column to orders table if it doesn't exist (for existing installations)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'orders' AND column_name = 'delivery_time'
    ) THEN
        ALTER TABLE orders 
        ADD COLUMN delivery_time VARCHAR(255);
    END IF;
END $$;

-- Facebook Pages Integration
CREATE TABLE IF NOT EXISTS facebook_pages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    page_id VARCHAR(255) NOT NULL,
    page_name VARCHAR(255),
    access_token TEXT NOT NULL,
    auto_reply_messenger BOOLEAN DEFAULT false,
    auto_reply_comments BOOLEAN DEFAULT false,
    comment_reply_template TEXT,
    comment_dm_template TEXT,
    send_dm_on_comment BOOLEAN DEFAULT false,
    last_sync TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(merchant_id, page_id)
);

-- Shopify Stores Integration
CREATE TABLE IF NOT EXISTS shopify_stores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    shop_domain VARCHAR(255) NOT NULL,
    access_token TEXT NOT NULL,
    last_sync TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(merchant_id, shop_domain)
);

-- Storify Stores Integration
CREATE TABLE IF NOT EXISTS storify_stores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    store_domain VARCHAR(255) NOT NULL,
    api_base_url TEXT NOT NULL,
    access_token TEXT NOT NULL,
    products_endpoint TEXT NOT NULL DEFAULT '/api/storefront/products',
    auto_sync BOOLEAN DEFAULT false,
    sync_interval INTEGER DEFAULT 24,
    last_sync TIMESTAMP,
    last_products_sync TIMESTAMP,
    products_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(merchant_id, store_domain)
);

-- WhatsApp Business Integration (Cloud API — optional / non-Syria)
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

-- WhatsApp Web QR sessions (one isolated encrypted session per merchant)
CREATE TABLE IF NOT EXISTS whatsapp_web_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    phone_number VARCHAR(32),
    phone_digits VARCHAR(20),
    status VARCHAR(32) NOT NULL DEFAULT 'disconnected',
    creds_ciphertext TEXT,
    keys_ciphertext TEXT,
    auto_reply_enabled BOOLEAN NOT NULL DEFAULT false,
    welcome_message TEXT,
    last_connected_at TIMESTAMP,
    last_disconnect_at TIMESTAMP,
    last_disconnect_reason TEXT,
    last_qr_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (merchant_id)
);

-- Conversations Table (for chat history)
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    user_id VARCHAR(255),
    user_name VARCHAR(255),
    last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    conversation_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    current_intent VARCHAR(100),
    session_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    stage VARCHAR(50) NOT NULL DEFAULT 'discover',
    last_error TEXT
);

-- Messages Table
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    intent VARCHAR(100),
    entities JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Password Reset Tokens Table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User Notifications Table
CREATE TABLE IF NOT EXISTS user_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL DEFAULT 'info',
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP
);

-- Web Push subscriptions (PWA) — one row per device per merchant
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (merchant_id, endpoint)
);

-- Customers Table (CRM)
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    city VARCHAR(100),
    country VARCHAR(100),
    customer_type VARCHAR(50) DEFAULT 'regular' CHECK (customer_type IN ('regular', 'vip', 'wholesale', 'new')),
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'blocked')),
    total_orders INTEGER DEFAULT 0,
    total_spent DECIMAL(10, 2) DEFAULT 0,
    last_order_date TIMESTAMP,
    last_interaction_date TIMESTAMP,
    notes TEXT,
    tags TEXT[],
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Customer Interactions Table
CREATE TABLE IF NOT EXISTS customer_interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    interaction_type VARCHAR(50) NOT NULL CHECK (interaction_type IN ('message', 'call', 'email', 'order', 'complaint', 'review', 'note')),
    title VARCHAR(255),
    description TEXT,
    platform VARCHAR(50),
    related_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    related_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    created_by UUID REFERENCES merchants(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Customer Tags Table (for custom tags)
CREATE TABLE IF NOT EXISTS customer_tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(20) DEFAULT '#3B82F6',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(merchant_id, name)
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_products_merchant_id ON products(merchant_id);
CREATE INDEX IF NOT EXISTS idx_orders_merchant_id ON orders(merchant_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_services_merchant_id ON services(merchant_id);
CREATE INDEX IF NOT EXISTS idx_conversations_merchant_id ON conversations(merchant_id);
CREATE INDEX IF NOT EXISTS idx_conversations_merchant_platform_user ON conversations(merchant_id, platform, user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_state_gin ON conversations USING GIN (conversation_state);
CREATE INDEX IF NOT EXISTS idx_conversations_current_intent ON conversations(current_intent);
CREATE INDEX IF NOT EXISTS idx_conversations_stage ON conversations(stage);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_entities_gin ON messages USING GIN (entities);
CREATE INDEX IF NOT EXISTS idx_messages_intent ON messages(intent);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_merchant_id ON password_reset_tokens(merchant_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_notifications_merchant_id ON user_notifications(merchant_id);
CREATE INDEX IF NOT EXISTS idx_user_notifications_is_read ON user_notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_user_notifications_created_at ON user_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_notifications_unread ON user_notifications(merchant_id, is_read, created_at DESC) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_merchant_id ON push_subscriptions(merchant_id);

-- CRM Indexes
CREATE INDEX IF NOT EXISTS idx_customers_merchant_id ON customers(merchant_id);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_customer_type ON customers(customer_type);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_last_order_date ON customers(last_order_date DESC);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_customer_id ON customer_interactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_merchant_id ON customer_interactions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_type ON customer_interactions(interaction_type);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_created_at ON customer_interactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_tags_merchant_id ON customer_tags(merchant_id);

-- Partial unique index for customer email (only when email is not null and not empty)
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_merchant_email_unique 
ON customers(merchant_id, email) 
WHERE email IS NOT NULL AND email != '';

-- Analytics Events Table (for tracking user actions)
CREATE TABLE IF NOT EXISTS analytics_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    event_category VARCHAR(100),
    event_data JSONB,
    platform VARCHAR(50),
    user_agent TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Analytics Daily Summary Table (for performance optimization)
CREATE TABLE IF NOT EXISTS analytics_daily_summary (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    summary_date DATE NOT NULL,
    total_orders INTEGER DEFAULT 0,
    total_revenue DECIMAL(10, 2) DEFAULT 0,
    total_conversations INTEGER DEFAULT 0,
    total_messages INTEGER DEFAULT 0,
    new_customers INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(merchant_id, summary_date)
);

-- Product Performance Table
CREATE TABLE IF NOT EXISTS product_performance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    product_name VARCHAR(255) NOT NULL,
    views_count INTEGER DEFAULT 0,
    orders_count INTEGER DEFAULT 0,
    revenue DECIMAL(10, 2) DEFAULT 0,
    conversion_rate DECIMAL(5, 2) DEFAULT 0,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Conversation Analytics Table
CREATE TABLE IF NOT EXISTS conversation_analytics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    platform VARCHAR(50),
    message_count INTEGER DEFAULT 0,
    response_time_avg INTEGER DEFAULT 0, -- in seconds
    converted_to_order BOOLEAN DEFAULT FALSE,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    customer_satisfaction INTEGER, -- 1-5 rating
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for analytics
CREATE INDEX IF NOT EXISTS idx_analytics_events_merchant_id ON analytics_events(merchant_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_daily_summary_merchant_id ON analytics_daily_summary(merchant_id);
CREATE INDEX IF NOT EXISTS idx_analytics_daily_summary_date ON analytics_daily_summary(summary_date DESC);
CREATE INDEX IF NOT EXISTS idx_product_performance_merchant_id ON product_performance(merchant_id);
CREATE INDEX IF NOT EXISTS idx_product_performance_product_id ON product_performance(product_id);
CREATE INDEX IF NOT EXISTS idx_conversation_analytics_merchant_id ON conversation_analytics(merchant_id);
CREATE INDEX IF NOT EXISTS idx_conversation_analytics_conversation_id ON conversation_analytics(conversation_id);

-- =============================================
-- SHOPIFY ENHANCED INTEGRATION TABLES
-- =============================================

-- Product Variants Table (for storing product variations like size, color)
CREATE TABLE IF NOT EXISTS product_variants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    external_id VARCHAR(255), -- Shopify variant ID
    sku VARCHAR(255),
    title VARCHAR(255), -- e.g., "Large / Red"
    price DECIMAL(10, 2) NOT NULL,
    compare_at_price DECIMAL(10, 2), -- Original price for sale items
    currency VARCHAR(10) DEFAULT 'USD',
    inventory_quantity INTEGER DEFAULT 0,
    inventory_policy VARCHAR(50) DEFAULT 'deny', -- 'deny' or 'continue'
    weight DECIMAL(10, 2),
    weight_unit VARCHAR(10) DEFAULT 'kg',
    option1 VARCHAR(255), -- e.g., "Large"
    option2 VARCHAR(255), -- e.g., "Red"
    option3 VARCHAR(255), -- e.g., "Cotton"
    barcode VARCHAR(255),
    requires_shipping BOOLEAN DEFAULT true,
    taxable BOOLEAN DEFAULT true,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Product Images Table (for multiple product images)
CREATE TABLE IF NOT EXISTS product_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    external_id VARCHAR(255), -- Shopify image ID
    src TEXT NOT NULL, -- Image URL
    alt TEXT, -- Alt text for accessibility
    position INTEGER DEFAULT 0, -- Image order
    width INTEGER,
    height INTEGER,
    is_primary BOOLEAN DEFAULT false,
    variant_ids UUID[], -- Associated variants
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Product Options Table (for product options like Size, Color)
CREATE TABLE IF NOT EXISTS product_options (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    external_id VARCHAR(255), -- Shopify option ID
    name VARCHAR(255) NOT NULL, -- e.g., "Size", "Color"
    position INTEGER DEFAULT 0,
    values TEXT[], -- e.g., ["Small", "Medium", "Large"]
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sync Jobs Table (for tracking sync operations)
CREATE TABLE IF NOT EXISTS sync_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL, -- 'shopify', 'facebook', etc.
    job_type VARCHAR(50) NOT NULL, -- 'products', 'orders', 'inventory', 'full'
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed', 'cancelled'
    total_items INTEGER DEFAULT 0,
    processed_items INTEGER DEFAULT 0,
    created_items INTEGER DEFAULT 0,
    updated_items INTEGER DEFAULT 0,
    failed_items INTEGER DEFAULT 0,
    current_page INTEGER DEFAULT 0,
    total_pages INTEGER DEFAULT 0,
    error_message TEXT,
    error_details JSONB,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sync Schedules Table (for automatic sync scheduling)
CREATE TABLE IF NOT EXISTS sync_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    job_type VARCHAR(50) NOT NULL,
    schedule_type VARCHAR(50) NOT NULL, -- 'hourly', 'daily', 'weekly', 'custom'
    cron_expression VARCHAR(100), -- For custom schedules
    is_active BOOLEAN DEFAULT true,
    last_run_at TIMESTAMP,
    next_run_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(merchant_id, platform, job_type)
);

-- Add columns to products table for enhanced Shopify data
DO $$ 
BEGIN
    -- Add vendor column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'products' AND column_name = 'vendor'
    ) THEN
        ALTER TABLE products ADD COLUMN vendor VARCHAR(255);
    END IF;
    
    -- Add product_type column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'products' AND column_name = 'product_type'
    ) THEN
        ALTER TABLE products ADD COLUMN product_type VARCHAR(255);
    END IF;
    
    -- Add tags column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'products' AND column_name = 'tags'
    ) THEN
        ALTER TABLE products ADD COLUMN tags TEXT[];
    END IF;
    
    -- Add status column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'products' AND column_name = 'status'
    ) THEN
        ALTER TABLE products ADD COLUMN status VARCHAR(50) DEFAULT 'active';
    END IF;
    
    -- Add handle column (URL slug)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'products' AND column_name = 'handle'
    ) THEN
        ALTER TABLE products ADD COLUMN handle VARCHAR(255);
    END IF;
    
    -- Add total_inventory column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'products' AND column_name = 'total_inventory'
    ) THEN
        ALTER TABLE products ADD COLUMN total_inventory INTEGER DEFAULT 0;
    END IF;
    
    -- Add has_variants column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'products' AND column_name = 'has_variants'
    ) THEN
        ALTER TABLE products ADD COLUMN has_variants BOOLEAN DEFAULT false;
    END IF;
END $$;

-- Add columns to shopify_stores for enhanced settings
DO $$ 
BEGIN
    -- Add auto_sync column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shopify_stores' AND column_name = 'auto_sync'
    ) THEN
        ALTER TABLE shopify_stores ADD COLUMN auto_sync BOOLEAN DEFAULT false;
    END IF;
    
    -- Add sync_interval column (in hours)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shopify_stores' AND column_name = 'sync_interval'
    ) THEN
        ALTER TABLE shopify_stores ADD COLUMN sync_interval INTEGER DEFAULT 24;
    END IF;
    
    -- Add sync_products column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shopify_stores' AND column_name = 'sync_products'
    ) THEN
        ALTER TABLE shopify_stores ADD COLUMN sync_products BOOLEAN DEFAULT true;
    END IF;
    
    -- Add sync_orders column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shopify_stores' AND column_name = 'sync_orders'
    ) THEN
        ALTER TABLE shopify_stores ADD COLUMN sync_orders BOOLEAN DEFAULT true;
    END IF;
    
    -- Add sync_inventory column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shopify_stores' AND column_name = 'sync_inventory'
    ) THEN
        ALTER TABLE shopify_stores ADD COLUMN sync_inventory BOOLEAN DEFAULT true;
    END IF;
    
    -- Add webhooks_registered column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shopify_stores' AND column_name = 'webhooks_registered'
    ) THEN
        ALTER TABLE shopify_stores ADD COLUMN webhooks_registered BOOLEAN DEFAULT false;
    END IF;
    
    -- Add last_products_sync column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shopify_stores' AND column_name = 'last_products_sync'
    ) THEN
        ALTER TABLE shopify_stores ADD COLUMN last_products_sync TIMESTAMP;
    END IF;
    
    -- Add last_orders_sync column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shopify_stores' AND column_name = 'last_orders_sync'
    ) THEN
        ALTER TABLE shopify_stores ADD COLUMN last_orders_sync TIMESTAMP;
    END IF;
    
    -- Add products_count column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shopify_stores' AND column_name = 'products_count'
    ) THEN
        ALTER TABLE shopify_stores ADD COLUMN products_count INTEGER DEFAULT 0;
    END IF;
    
    -- Add orders_count column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'shopify_stores' AND column_name = 'orders_count'
    ) THEN
        ALTER TABLE shopify_stores ADD COLUMN orders_count INTEGER DEFAULT 0;
    END IF;
END $$;

-- Indexes for enhanced Shopify tables
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_merchant_id ON product_variants(merchant_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_external_id ON product_variants(external_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_sku ON product_variants(sku);

CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_merchant_id ON product_images(merchant_id);
CREATE INDEX IF NOT EXISTS idx_product_images_is_primary ON product_images(is_primary);

CREATE INDEX IF NOT EXISTS idx_product_options_product_id ON product_options(product_id);
CREATE INDEX IF NOT EXISTS idx_product_options_merchant_id ON product_options(merchant_id);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_merchant_id ON sync_jobs(merchant_id);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_platform ON sync_jobs(platform);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_created_at ON sync_jobs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_schedules_merchant_id ON sync_schedules(merchant_id);
CREATE INDEX IF NOT EXISTS idx_sync_schedules_next_run_at ON sync_schedules(next_run_at);
CREATE INDEX IF NOT EXISTS idx_sync_schedules_is_active ON sync_schedules(is_active);

CREATE INDEX IF NOT EXISTS idx_products_external_id ON products(external_id);
CREATE INDEX IF NOT EXISTS idx_products_source ON products(source);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_vendor ON products(vendor);

-- Unique constraint for external_id per merchant
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_merchant_external_unique 
ON products(merchant_id, external_id) 
WHERE external_id IS NOT NULL;

-- Instagram Business Accounts Integration
CREATE TABLE IF NOT EXISTS instagram_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    ig_user_id VARCHAR(255) NOT NULL,
    ig_username VARCHAR(255),
    page_id VARCHAR(255) NOT NULL,
    access_token TEXT NOT NULL,
    auto_reply_comments BOOLEAN DEFAULT true,
    auto_reply_dm BOOLEAN DEFAULT true,
    send_dm_on_comment BOOLEAN DEFAULT true,
    comment_reply_template TEXT,
    comment_dm_template TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(merchant_id, ig_user_id)
);

CREATE INDEX IF NOT EXISTS idx_instagram_accounts_merchant ON instagram_accounts(merchant_id);
CREATE INDEX IF NOT EXISTS idx_instagram_accounts_page ON instagram_accounts(page_id);
CREATE INDEX IF NOT EXISTS idx_instagram_accounts_ig_user ON instagram_accounts(ig_user_id);


-- Content publishing & scheduling (see migrations/add_content_publishing.sql)
CREATE TABLE IF NOT EXISTS content_publications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  caption TEXT,
  media_kind VARCHAR(32) NOT NULL DEFAULT 'image'
    CHECK (media_kind IN ('none', 'image', 'video', 'carousel')),
  status VARCHAR(32) NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'scheduled', 'publishing', 'published', 'partial', 'failed', 'cancelled'
    )),
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES merchants(id) ON DELETE SET NULL,
  error_summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_content_publications_merchant ON content_publications(merchant_id);
CREATE INDEX IF NOT EXISTS idx_content_publications_merchant_status ON content_publications(merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_content_publications_due ON content_publications(scheduled_at) WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS content_publication_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  publication_id UUID NOT NULL REFERENCES content_publications(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  media_type VARCHAR(16) NOT NULL CHECK (media_type IN ('image', 'video')),
  media_url TEXT NOT NULL,
  thumbnail_url TEXT,
  alt_text TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_content_publication_media_order UNIQUE (publication_id, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_content_publication_media_merchant ON content_publication_media(merchant_id);
CREATE INDEX IF NOT EXISTS idx_content_publication_media_pub ON content_publication_media(publication_id);

CREATE TABLE IF NOT EXISTS content_publication_targets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  publication_id UUID NOT NULL REFERENCES content_publications(id) ON DELETE CASCADE,
  platform VARCHAR(32) NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  account_ref VARCHAR(255) NOT NULL,
  account_label VARCHAR(255),
  status VARCHAR(32) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'publishing', 'published', 'failed', 'skipped')),
  external_post_id VARCHAR(255),
  permalink TEXT,
  container_id VARCHAR(255),
  error_message TEXT,
  published_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_content_publication_target UNIQUE (publication_id, platform, account_ref)
);

CREATE INDEX IF NOT EXISTS idx_content_publication_targets_merchant ON content_publication_targets(merchant_id);
CREATE INDEX IF NOT EXISTS idx_content_publication_targets_pub ON content_publication_targets(publication_id);
CREATE INDEX IF NOT EXISTS idx_content_publication_targets_status ON content_publication_targets(merchant_id, status);
