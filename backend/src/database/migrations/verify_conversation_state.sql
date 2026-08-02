-- Verification query to confirm conversation state columns exist
-- Run this after migration to verify all columns were added successfully

-- Check conversations table columns
SELECT 
    column_name, 
    data_type, 
    column_default,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'conversations' 
    AND column_name IN (
        'conversation_state',
        'current_intent',
        'session_metadata',
        'stage'
    )
ORDER BY column_name;

-- Check messages table columns
SELECT 
    column_name, 
    data_type, 
    column_default,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'messages' 
    AND column_name IN (
        'metadata',
        'intent',
        'entities'
    )
ORDER BY column_name;

-- Check indexes
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename IN ('conversations', 'messages')
    AND indexname IN (
        'idx_conversations_state_gin',
        'idx_conversations_current_intent',
        'idx_conversations_stage',
        'idx_messages_entities_gin',
        'idx_messages_intent'
    )
ORDER BY tablename, indexname;

-- Quick test: Insert and query sample data
DO $$
DECLARE
    test_conv_id UUID;
    test_msg_id UUID;
BEGIN
    -- Create a test conversation (if merchants table has at least one merchant)
    IF EXISTS (SELECT 1 FROM merchants LIMIT 1) THEN
        INSERT INTO conversations (
            merchant_id,
            platform,
            user_id,
            conversation_state,
            current_intent,
            session_metadata,
            stage
        )
        SELECT 
            id,
            'web',
            'test_user',
            '{"lead_score": 75, "last_recommended_products": []}'::jsonb,
            'browse',
            '{"source": "test"}'::jsonb,
            'discover'
        FROM merchants
        LIMIT 1
        RETURNING id INTO test_conv_id;
        
        -- Create a test message
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
                '{"products": []}'::jsonb
            )
            RETURNING id INTO test_msg_id;
            
            -- Clean up test data
            DELETE FROM messages WHERE id = test_msg_id;
            DELETE FROM conversations WHERE id = test_conv_id;
            
            RAISE NOTICE '✅ Test data inserted and cleaned up successfully';
        END IF;
    ELSE
        RAISE NOTICE '⚠️  No merchants found, skipping test data insertion';
    END IF;
END $$;

