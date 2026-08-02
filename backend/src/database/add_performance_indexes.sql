-- Performance Indexes for SaaS Multi-Tenant Platform
-- Run this to improve query performance with hundreds of merchants and thousands of products

-- Products table - Full text search optimization
CREATE INDEX IF NOT EXISTS idx_products_merchant_name_lower 
ON products(merchant_id, LOWER(name));

CREATE INDEX IF NOT EXISTS idx_products_merchant_category_lower 
ON products(merchant_id, LOWER(category)) WHERE category IS NOT NULL;

-- Composite index for common search patterns
CREATE INDEX IF NOT EXISTS idx_products_merchant_stock 
ON products(merchant_id, stock) WHERE stock > 0;

-- Conversations table - Fast lookup for active conversations
CREATE INDEX IF NOT EXISTS idx_conversations_merchant_platform_user 
ON conversations(merchant_id, platform, user_id, last_message_at DESC);

-- Messages table - Fast recent messages retrieval
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created 
ON messages(conversation_id, created_at DESC);

-- Orders table - Fast merchant queries
CREATE INDEX IF NOT EXISTS idx_orders_merchant_status_created 
ON orders(merchant_id, status, created_at DESC);

-- Analyze tables after creating indexes
ANALYZE products;
ANALYZE conversations;
ANALYZE messages;
ANALYZE orders;

-- Print success message
SELECT 'Performance indexes created successfully!' as status;

