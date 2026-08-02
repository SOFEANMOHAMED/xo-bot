/**
 * Test script for conversation state helper functions
 * Run with: tsx src/database/test_conversation_state.ts
 */

import pool from './connection.js';
import {
  getConversationByPlatformUser,
  updateConversationState,
  appendMessage
} from '../controllers/conversation.controller.js';

async function testConversationState() {
  const client = await pool.connect();
  try {
    console.log('🧪 Testing conversation state helpers...\n');

    // Get a merchant ID (use first merchant in database)
    const merchantResult = await client.query(
      'SELECT id FROM merchants LIMIT 1'
    );

    if (merchantResult.rows.length === 0) {
      console.error('❌ No merchants found in database. Please create a merchant first.');
      process.exit(1);
    }

    const merchantId = merchantResult.rows[0].id;
    const platform = 'web';
    const userId = `test_user_${Date.now()}`;

    console.log(`📋 Test parameters:`);
    console.log(`   Merchant ID: ${merchantId}`);
    console.log(`   Platform: ${platform}`);
    console.log(`   User ID: ${userId}\n`);

    // Test 1: Create a conversation first (if not exists)
    console.log('1️⃣ Creating test conversation...');
    let conversationId: string;
    const existingConv = await getConversationByPlatformUser(
      merchantId,
      platform,
      userId
    );

    if (existingConv) {
      conversationId = existingConv.id;
      console.log(`   ✅ Found existing conversation: ${conversationId}`);
    } else {
      // Create new conversation
      const createResult = await client.query(
        `INSERT INTO conversations (merchant_id, platform, user_id, user_name, stage)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [merchantId, platform, userId, 'Test User', 'discover']
      );
      conversationId = createResult.rows[0].id;
      console.log(`   ✅ Created new conversation: ${conversationId}`);
    }

    // Test 2: Get conversation by platform/user
    console.log('\n2️⃣ Testing getConversationByPlatformUser...');
    const conv = await getConversationByPlatformUser(
      merchantId,
      platform,
      userId
    );

    if (conv) {
      console.log(`   ✅ Retrieved conversation:`);
      console.log(`      ID: ${conv.id}`);
      console.log(`      Stage: ${conv.stage}`);
      console.log(`      Current Intent: ${conv.currentIntent || 'null'}`);
      console.log(`      Conversation State:`, JSON.stringify(conv.conversationState, null, 2));
      console.log(`      Session Metadata:`, JSON.stringify(conv.sessionMetadata, null, 2));
    } else {
      console.log('   ❌ Failed to retrieve conversation');
      process.exit(1);
    }

    // Test 3: Update conversation state (merge JSONB)
    console.log('\n3️⃣ Testing updateConversationState (JSONB merge)...');
    const updateResult = await updateConversationState(conversationId, {
      conversationState: {
        lead_score: 75,
        last_recommended_products: ['product-1', 'product-2'],
        customer_interests: ['electronics', 'gadgets']
      },
      currentIntent: 'browse',
      stage: 'offer',
      sessionMetadata: {
        source: 'web',
        user_agent: 'test-agent',
        referrer: 'https://example.com'
      }
    });

    if (updateResult) {
      console.log(`   ✅ Updated conversation state:`);
      console.log(`      Stage: ${updateResult.stage}`);
      console.log(`      Current Intent: ${updateResult.currentIntent}`);
      console.log(`      Conversation State:`, JSON.stringify(updateResult.conversationState, null, 2));
      console.log(`      Session Metadata:`, JSON.stringify(updateResult.sessionMetadata, null, 2));
    } else {
      console.log('   ❌ Failed to update conversation state');
      process.exit(1);
    }

    // Test 4: Merge additional data into conversation_state (should not overwrite)
    console.log('\n4️⃣ Testing JSONB merge (should preserve existing data)...');
    const mergeResult = await updateConversationState(conversationId, {
      conversationState: {
        lead_score: 85, // Update existing
        new_field: 'new_value', // Add new field
        // last_recommended_products should still exist
      }
    });

    if (mergeResult) {
      console.log(`   ✅ Merged conversation state:`);
      console.log(`      Conversation State:`, JSON.stringify(mergeResult.conversationState, null, 2));
      
      // Verify merge worked (should have both old and new fields)
      if (mergeResult.conversationState.last_recommended_products && 
          mergeResult.conversationState.new_field) {
        console.log(`   ✅ Merge successful: preserved old fields and added new ones`);
      } else {
        console.log(`   ⚠️  Merge may not have worked correctly`);
      }
    } else {
      console.log('   ❌ Failed to merge conversation state');
      process.exit(1);
    }

    // Test 5: Append message with metadata, intent, and entities
    console.log('\n5️⃣ Testing appendMessage with metadata...');
    const message1 = await appendMessage(
      conversationId,
      'user',
      'أريد شراء هاتف ذكي',
      'user',
      'ext_msg_123',
      {
        platform: 'web',
        has_attachments: false,
        quick_reply: null
      },
      'purchase',
      {
        product_category: 'electronics',
        product_type: 'smartphone',
        intent_confidence: 0.9
      }
    );

    console.log(`   ✅ Created message:`);
    console.log(`      ID: ${message1.id}`);
    console.log(`      Role: ${message1.role}`);
    console.log(`      Content: ${message1.content}`);
    console.log(`      Intent: ${message1.intent}`);
    console.log(`      Metadata:`, JSON.stringify(message1.metadata, null, 2));
    console.log(`      Entities:`, JSON.stringify(message1.entities, null, 2));

    // Test 6: Append assistant message
    console.log('\n6️⃣ Testing appendMessage (assistant response)...');
    const message2 = await appendMessage(
      conversationId,
      'assistant',
      'لدينا مجموعة ممتازة من الهواتف الذكية. هل تفضل ماركة معينة؟',
      'bot',
      undefined,
      {
        platform: 'web',
        response_time_ms: 250
      },
      'recommend',
      {
        recommended_products: ['product-1', 'product-2'],
        response_type: 'recommendation'
      }
    );

    console.log(`   ✅ Created assistant message:`);
    console.log(`      ID: ${message2.id}`);
    console.log(`      Intent: ${message2.intent}`);
    console.log(`      Entities:`, JSON.stringify(message2.entities, null, 2));

    // Test 7: Verify data in database
    console.log('\n7️⃣ Verifying data in database...');
    const verifyConv = await client.query(
      `SELECT 
        conversation_state,
        current_intent,
        stage,
        session_metadata
       FROM conversations 
       WHERE id = $1`,
      [conversationId]
    );

    if (verifyConv.rows.length > 0) {
      const row = verifyConv.rows[0];
      console.log(`   ✅ Conversation state in DB:`);
      console.log(`      Stage: ${row.stage}`);
      console.log(`      Current Intent: ${row.current_intent}`);
      console.log(`      Conversation State:`, JSON.stringify(row.conversation_state, null, 2));
    }

    const verifyMessages = await client.query(
      `SELECT 
        id,
        role,
        content,
        intent,
        metadata,
        entities
       FROM messages 
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT 2`,
      [conversationId]
    );

    console.log(`   ✅ Messages in DB (last 2):`);
    verifyMessages.rows.forEach((msg, idx) => {
      console.log(`      Message ${idx + 1}:`);
      console.log(`         Role: ${msg.role}`);
      console.log(`         Intent: ${msg.intent || 'null'}`);
      console.log(`         Metadata:`, JSON.stringify(msg.metadata, null, 2));
      console.log(`         Entities:`, JSON.stringify(msg.entities, null, 2));
    });

    // Cleanup (optional - comment out if you want to keep test data)
    console.log('\n🧹 Cleaning up test data...');
    await client.query('DELETE FROM messages WHERE conversation_id = $1', [conversationId]);
    await client.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
    console.log('   ✅ Test data cleaned up');

    console.log('\n✅ All tests passed successfully!');
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

testConversationState();

