-- Migration: Add performance indexes for SaaS search optimization
-- Supports hundreds of stores and thousands of products

-- 1. Enable trigram extension for fuzzy matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Add composite index for merchant products (most important for SaaS)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_merchant_search 
ON products (merchant_id, stock DESC, created_at DESC);

-- 3. Add trigram indexes for fuzzy text search (Arabic-friendly)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_name_trgm 
ON products USING GIN (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_description_trgm 
ON products USING GIN (description gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_category_trgm 
ON products USING GIN (category gin_trgm_ops);

-- 4. Add lower-case indexes for case-insensitive exact matching
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_name_lower 
ON products (merchant_id, LOWER(name));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_category_lower 
ON products (merchant_id, LOWER(category));

-- 5. Add index for conversations lookup (critical for SaaS)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_merchant_platform_user 
ON conversations (merchant_id, platform, user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_last_message 
ON conversations (merchant_id, last_message_at DESC);

-- 6. Add index for messages retrieval
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_conversation_created 
ON messages (conversation_id, created_at DESC);

-- 7. Add index for orders lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_merchant_status_created 
ON orders (merchant_id, status, created_at DESC);

-- 8. Add index for merchant settings cache
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merchant_settings_merchant 
ON merchant_settings (merchant_id);

-- 9. Analyze tables to update statistics for query planner
ANALYZE products;
ANALYZE conversations;
ANALYZE messages;
ANALYZE orders;
ANALYZE merchant_settings;

