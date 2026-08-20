-- Official page human takeover (pause AI when page inbox replies)
ALTER TABLE platform_conversations
  ADD COLUMN IF NOT EXISTS bot_disabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE platform_conversations
  ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'bot';

ALTER TABLE platform_conversations
  ADD COLUMN IF NOT EXISTS last_human_response_at TIMESTAMP;

ALTER TABLE platform_messages
  ADD COLUMN IF NOT EXISTS external_message_id VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_messages_external
  ON platform_messages(conversation_id, external_message_id)
  WHERE external_message_id IS NOT NULL;
