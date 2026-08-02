-- Migration: Add conversation state columns for smart sales bot
-- This adds support for intent tracking, conversation stages, and metadata storage

-- Add columns to conversations table
DO $$ 
BEGIN
    -- Add conversation_state JSONB column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'conversations' AND column_name = 'conversation_state'
    ) THEN
        ALTER TABLE conversations 
        ADD COLUMN conversation_state JSONB DEFAULT '{}'::jsonb;
    END IF;
    
    -- Add current_intent VARCHAR column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'conversations' AND column_name = 'current_intent'
    ) THEN
        ALTER TABLE conversations 
        ADD COLUMN current_intent VARCHAR(100);
    END IF;
    
    -- Add session_metadata JSONB column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'conversations' AND column_name = 'session_metadata'
    ) THEN
        ALTER TABLE conversations 
        ADD COLUMN session_metadata JSONB DEFAULT '{}'::jsonb;
    END IF;
    
    -- Add stage VARCHAR column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'conversations' AND column_name = 'stage'
    ) THEN
        ALTER TABLE conversations 
        ADD COLUMN stage VARCHAR(50) DEFAULT 'discover';
    END IF;
END $$;

-- Add columns to messages table
DO $$ 
BEGIN
    -- Add metadata JSONB column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'messages' AND column_name = 'metadata'
    ) THEN
        ALTER TABLE messages 
        ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
    END IF;
    
    -- Add intent VARCHAR column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'messages' AND column_name = 'intent'
    ) THEN
        ALTER TABLE messages 
        ADD COLUMN intent VARCHAR(100);
    END IF;
    
    -- Add entities JSONB column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'messages' AND column_name = 'entities'
    ) THEN
        ALTER TABLE messages 
        ADD COLUMN entities JSONB DEFAULT '{}'::jsonb;
    END IF;
END $$;

-- Create GIN index on conversation_state for efficient JSON queries
CREATE INDEX IF NOT EXISTS idx_conversations_state_gin ON conversations USING GIN (conversation_state);

-- Create index on current_intent for faster intent-based queries
CREATE INDEX IF NOT EXISTS idx_conversations_current_intent ON conversations(current_intent);

-- Create index on stage for faster stage-based queries
CREATE INDEX IF NOT EXISTS idx_conversations_stage ON conversations(stage);

-- Create GIN index on messages.entities for efficient entity queries
CREATE INDEX IF NOT EXISTS idx_messages_entities_gin ON messages USING GIN (entities);

-- Create index on messages.intent for faster intent-based message queries
CREATE INDEX IF NOT EXISTS idx_messages_intent ON messages(intent);

