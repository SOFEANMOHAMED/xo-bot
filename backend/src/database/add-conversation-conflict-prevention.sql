-- Add columns to conversations table for conflict prevention
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS bot_disabled BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_human_response_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS last_bot_response_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'bot' CHECK (status IN ('bot', 'human', 'hybrid'));

-- Add columns to messages table for tracking message source
ALTER TABLE messages
ADD COLUMN IF NOT EXISTS sender_type VARCHAR(20) DEFAULT 'bot' CHECK (sender_type IN ('bot', 'human', 'system', 'user')),
ADD COLUMN IF NOT EXISTS external_message_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'webhook' CHECK (source IN ('webhook', 'api', 'facebook_inbox', 'whatsapp_manager', 'telegram', 'whatsapp', 'facebook_messenger'));

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversations_bot_disabled ON conversations(bot_disabled, last_human_response_at);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status, last_human_response_at);
CREATE INDEX IF NOT EXISTS idx_messages_external_id ON messages(external_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_type ON messages(conversation_id, sender_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_source ON messages(conversation_id, source, created_at DESC);

