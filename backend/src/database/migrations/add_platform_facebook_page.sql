-- Official XO Bot Facebook page (platform-owned, not merchant-scoped)
CREATE TABLE IF NOT EXISTS platform_facebook_pages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    page_id VARCHAR(255) NOT NULL UNIQUE,
    page_name VARCHAR(255),
    access_token TEXT NOT NULL,
    linked_by_merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Isolated conversations for the official page bot (no merchant CRM / orders)
CREATE TABLE IF NOT EXISTS platform_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    page_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    user_name VARCHAR(255),
    conversation_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(page_id, user_id)
);

CREATE TABLE IF NOT EXISTS platform_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES platform_conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_platform_messages_conversation
  ON platform_messages(conversation_id, created_at);
