-- Verification queries for hybrid orchestrator migration
-- Run these queries to confirm all columns and indexes exist

-- ==================== VERIFY CONVERSATIONS TABLE ====================

-- Check all required columns in conversations table
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'conversations' 
    AND column_name IN (
        'conversation_state',
        'current_intent',
        'session_metadata',
        'stage',
        'last_error'
    )
ORDER BY column_name;

-- Expected result: 5 rows
-- conversation_state: JSONB, NOT NULL, DEFAULT '{}'::jsonb
-- current_intent: VARCHAR(100), nullable
-- session_metadata: JSONB, NOT NULL, DEFAULT '{}'::jsonb
-- stage: VARCHAR(50), NOT NULL, DEFAULT 'discover'
-- last_error: TEXT, nullable

-- ==================== VERIFY MESSAGES TABLE ====================

-- Check all required columns in messages table
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'messages' 
    AND column_name IN (
        'metadata',
        'intent',
        'entities'
    )
ORDER BY column_name;

-- Expected result: 3 rows
-- metadata: JSONB, NOT NULL, DEFAULT '{}'::jsonb
-- intent: VARCHAR(100), nullable
-- entities: JSONB, NOT NULL, DEFAULT '{}'::jsonb

-- ==================== VERIFY INDEXES ====================

-- Check composite index on conversations
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename = 'conversations'
    AND indexname = 'idx_conversations_merchant_platform_user';

-- Expected: 1 row with index on (merchant_id, platform, user_id)

-- Check all conversation indexes
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename = 'conversations'
    AND indexname IN (
        'idx_conversations_merchant_id',
        'idx_conversations_merchant_platform_user',
        'idx_conversations_state_gin',
        'idx_conversations_current_intent',
        'idx_conversations_stage'
    )
ORDER BY indexname;

-- Check all message indexes
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename = 'messages'
    AND indexname IN (
        'idx_messages_conversation_id',
        'idx_messages_entities_gin',
        'idx_messages_intent'
    )
ORDER BY indexname;

-- ==================== TEST DATA INSERTION ====================

-- Test inserting data with new columns (if merchants table has data)
DO $$
DECLARE
    test_merchant_id UUID;
    test_conv_id UUID;
    test_msg_id UUID;
BEGIN
    -- Get first merchant
    SELECT id INTO test_merchant_id FROM merchants LIMIT 1;
    
    IF test_merchant_id IS NOT NULL THEN
        -- Test conversation insertion
        INSERT INTO conversations (
            merchant_id,
            platform,
            user_id,
            conversation_state,
            current_intent,
            session_metadata,
            stage,
            last_error
        )
        VALUES (
            test_merchant_id,
            'web',
            'test_user_hybrid',
            '{"test": "data"}'::jsonb,
            'browse',
            '{"source": "test"}'::jsonb,
            'discover',
            NULL
        )
        RETURNING id INTO test_conv_id;
        
        -- Test message insertion
        IF test_conv_id IS NOT NULL THEN
            INSERT INTO messages (
                conversation_id,
                role,
                content,
                metadata,
                intent,
                entities
            )
            VALUES (
                test_conv_id,
                'user',
                'Test message',
                '{"platform": "web"}'::jsonb,
                'browse',
                '{"test": "entity"}'::jsonb
            )
            RETURNING id INTO test_msg_id;
            
            -- Clean up
            DELETE FROM messages WHERE id = test_msg_id;
            DELETE FROM conversations WHERE id = test_conv_id;
            
            RAISE NOTICE '✅ Test data inserted and cleaned up successfully';
        END IF;
    ELSE
        RAISE NOTICE '⚠️  No merchants found, skipping test data insertion';
    END IF;
END $$;

