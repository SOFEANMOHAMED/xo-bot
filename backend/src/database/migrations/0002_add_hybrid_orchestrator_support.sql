-- Migration: Add support for hybrid orchestrator across all channels
-- This migration ensures all required columns exist for channel-agnostic orchestrator
-- Date: 2024

-- ==================== CONVERSATIONS TABLE ====================

-- Add/ensure conversation_state column (with NOT NULL constraint if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'conversations' AND column_name = 'conversation_state'
    ) THEN
        ALTER TABLE conversations 
        ADD COLUMN conversation_state JSONB NOT NULL DEFAULT '{}'::jsonb;
    ELSE
        -- If column exists, update NULL values first, then make it NOT NULL
        UPDATE conversations 
        SET conversation_state = '{}'::jsonb 
        WHERE conversation_state IS NULL;
        
        ALTER TABLE conversations 
        ALTER COLUMN conversation_state SET NOT NULL,
        ALTER COLUMN conversation_state SET DEFAULT '{}'::jsonb;
    END IF;
END $$;

-- Add/ensure current_intent column
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'conversations' AND column_name = 'current_intent'
    ) THEN
        ALTER TABLE conversations 
        ADD COLUMN current_intent VARCHAR(100);
    END IF;
END $$;

-- Add/ensure session_metadata column (with NOT NULL constraint if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'conversations' AND column_name = 'session_metadata'
    ) THEN
        ALTER TABLE conversations 
        ADD COLUMN session_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
    ELSE
        -- If column exists, update NULL values first, then make it NOT NULL
        UPDATE conversations 
        SET session_metadata = '{}'::jsonb 
        WHERE session_metadata IS NULL;
        
        ALTER TABLE conversations 
        ALTER COLUMN session_metadata SET NOT NULL,
        ALTER COLUMN session_metadata SET DEFAULT '{}'::jsonb;
    END IF;
END $$;

-- Add/ensure stage column (with NOT NULL constraint if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'conversations' AND column_name = 'stage'
    ) THEN
        ALTER TABLE conversations 
        ADD COLUMN stage VARCHAR(50) NOT NULL DEFAULT 'discover';
    ELSE
        -- If column exists, update NULL values first, then make it NOT NULL
        UPDATE conversations 
        SET stage = 'discover' 
        WHERE stage IS NULL;
        
        ALTER TABLE conversations 
        ALTER COLUMN stage SET NOT NULL,
        ALTER COLUMN stage SET DEFAULT 'discover';
    END IF;
END $$;

-- Add last_error column (new column)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'conversations' AND column_name = 'last_error'
    ) THEN
        ALTER TABLE conversations 
        ADD COLUMN last_error TEXT;
    END IF;
END $$;

-- ==================== MESSAGES TABLE ====================

-- Add/ensure metadata column (with NOT NULL constraint if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'messages' AND column_name = 'metadata'
    ) THEN
        ALTER TABLE messages 
        ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
    ELSE
        -- If column exists, update NULL values first, then make it NOT NULL
        UPDATE messages 
        SET metadata = '{}'::jsonb 
        WHERE metadata IS NULL;
        
        ALTER TABLE messages 
        ALTER COLUMN metadata SET NOT NULL,
        ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;
    END IF;
END $$;

-- Add/ensure intent column
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'messages' AND column_name = 'intent'
    ) THEN
        ALTER TABLE messages 
        ADD COLUMN intent VARCHAR(100);
    END IF;
END $$;

-- Add/ensure entities column (with NOT NULL constraint if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'messages' AND column_name = 'entities'
    ) THEN
        ALTER TABLE messages 
        ADD COLUMN entities JSONB NOT NULL DEFAULT '{}'::jsonb;
    ELSE
        -- If column exists, update NULL values first, then make it NOT NULL
        UPDATE messages 
        SET entities = '{}'::jsonb 
        WHERE entities IS NULL;
        
        ALTER TABLE messages 
        ALTER COLUMN entities SET NOT NULL,
        ALTER COLUMN entities SET DEFAULT '{}'::jsonb;
    END IF;
END $$;

-- ==================== INDEXES ====================

-- Composite index on conversations(merchant_id, platform, user_id) for fast lookups
CREATE INDEX IF NOT EXISTS idx_conversations_merchant_platform_user 
ON conversations(merchant_id, platform, user_id);

-- GIN index on conversation_state (for JSONB queries - optional but recommended)
CREATE INDEX IF NOT EXISTS idx_conversations_state_gin 
ON conversations USING GIN (conversation_state);

-- Index on stage for faster stage-based queries
CREATE INDEX IF NOT EXISTS idx_conversations_stage 
ON conversations(stage);

-- Index on current_intent for faster intent-based queries
CREATE INDEX IF NOT EXISTS idx_conversations_current_intent 
ON conversations(current_intent);

-- GIN index on messages.entities (for JSONB queries)
CREATE INDEX IF NOT EXISTS idx_messages_entities_gin 
ON messages USING GIN (entities);

-- Index on messages.intent for faster intent-based message queries
CREATE INDEX IF NOT EXISTS idx_messages_intent 
ON messages(intent);

-- ==================== VERIFICATION QUERIES ====================
-- Run these queries to verify the migration:
--
-- Check conversations table columns:
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns 
-- WHERE table_name = 'conversations' 
--   AND column_name IN ('conversation_state', 'current_intent', 'session_metadata', 'stage', 'last_error')
-- ORDER BY column_name;
--
-- Check messages table columns:
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns 
-- WHERE table_name = 'messages' 
--   AND column_name IN ('metadata', 'intent', 'entities')
-- ORDER BY column_name;
--
-- Check indexes:
-- SELECT indexname, indexdef
-- FROM pg_indexes 
-- WHERE tablename IN ('conversations', 'messages')
--   AND indexname LIKE '%conversation%' OR indexname LIKE '%message%'
-- ORDER BY tablename, indexname;

