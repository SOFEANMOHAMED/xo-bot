/**
 * Test script for hybrid orchestrator conversation helpers
 * Tests: getOrCreateConversationHelper, appendMessage, patchConversationState, getRecentMessages, setConversationError
 */

import pool from './connection.js';
import {
  getOrCreateConversationHelper,
  appendMessage,
  patchConversationState,
  getRecentMessages,
  setConversationError
} from '../controllers/conversation.controller.js';
import crypto from 'crypto';

async function runTest() {
  // Use a test merchant ID (you may need to adjust this)
  const merchantId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'; // Use a dummy merchant ID
  const platform = 'test_platform';
  const userId = crypto.randomBytes(16).toString('hex'); // Unique user ID for each test run
  const userName = 'Test User';

  console.log('Starting hybrid orchestrator helpers tests...');
  console.log('Test parameters:', { merchantId, platform, userId, userName });

  let conversationId: string | null = null;

  try {
    // ==================== TEST 1: getOrCreateConversationHelper ====================
    console.log('\n--- Test 1: getOrCreateConversationHelper (create new) ---');
    let conversation = await getOrCreateConversationHelper({
      merchantId,
      platform,
      userId
    });
    conversationId = conversation.id;
    console.log('Created conversation:', {
      id: conversation.id,
      platform: conversation.platform,
      userId: conversation.userId,
      stage: conversation.stage,
      conversationState: conversation.conversationState,
      sessionMetadata: conversation.sessionMetadata
    });

    if (!conversationId) {
      throw new Error('Failed to create conversation');
    }

    // Verify initial state
    if (conversation.stage !== 'discover' || 
        Object.keys(conversation.conversationState).length !== 0 ||
        Object.keys(conversation.sessionMetadata).length !== 0) {
      throw new Error('Initial conversation state/stage not as expected');
    }

    // Test getting existing conversation
    console.log('\n--- Test 1b: getOrCreateConversationHelper (get existing) ---');
    const existingConversation = await getOrCreateConversationHelper({
      merchantId,
      platform,
      userId
    });
    if (existingConversation.id !== conversationId) {
      throw new Error('Returned different conversation ID');
    }
    console.log('✅ Successfully retrieved existing conversation');

    // ==================== TEST 2: appendMessage (old signature) ====================
    console.log('\n--- Test 2: appendMessage (old signature) ---');
    const messageId1 = await appendMessage(
      conversationId,
      'user',
      'مرحباً، أريد معرفة سعر المنتج',
      'user',
      'ext_msg_001',
      { platform: 'test', sentiment: 'neutral' },
      'price',
      { product_query: 'منتج' }
    );
    console.log('Appended user message (old signature):', messageId1.id);

    // ==================== TEST 3: appendMessage (with metadata, intent, entities) ====================
    console.log('\n--- Test 3: appendMessage (with metadata, intent, entities) ---');
    const messageId2 = await appendMessage(
      conversationId,
      'assistant',
      'سعر المنتج هو 100 دولار. هل تريد معرفة المزيد؟',
      'bot',
      undefined,
      { response_type: 'template', platform: 'test' },
      'provide_price',
      { price: '100', currency: 'USD' }
    );
    console.log('Appended assistant message:', messageId2.id);

    // ==================== TEST 4: getRecentMessages ====================
    console.log('\n--- Test 4: getRecentMessages ---');
    const recentMessages = await getRecentMessages(conversationId, 10);
    console.log('Recent messages:', {
      count: recentMessages.length,
      messages: recentMessages.map(m => ({
        role: m.role,
        content: m.content.substring(0, 50),
        intent: m.intent,
        entities: m.entities
      }))
    });

    if (recentMessages.length !== 2) {
      throw new Error(`Expected 2 messages, got ${recentMessages.length}`);
    }

    if (recentMessages[0].role !== 'user' || recentMessages[1].role !== 'assistant') {
      throw new Error('Messages order or roles incorrect');
    }

    // ==================== TEST 5: patchConversationState ====================
    console.log('\n--- Test 5: patchConversationState (merge state) ---');
    const patched1 = await patchConversationState(conversationId, {
      conversation_state: {
        lead_score: 75,
        interests: ['electronics', 'gaming'],
        last_user_message: 'مرحباً، أريد معرفة سعر المنتج'
      },
      current_intent: 'price',
      stage: 'offer',
      session_metadata: {
        source_channel: 'test',
        user_agent: 'test-script'
      }
    });
    console.log('Patched conversation state:', {
      stage: patched1?.stage,
      currentIntent: patched1?.currentIntent,
      conversationState: patched1?.conversationState,
      sessionMetadata: patched1?.sessionMetadata
    });

    if (patched1?.stage !== 'offer' || 
        patched1?.currentIntent !== 'price' ||
        patched1?.conversationState.lead_score !== 75) {
      throw new Error('Conversation state not patched correctly');
    }

    // Test merging (not overwriting)
    console.log('\n--- Test 5b: patchConversationState (merge, not overwrite) ---');
    const patched2 = await patchConversationState(conversationId, {
      conversation_state: {
        last_product_viewed: 'product_xyz',
        interests: ['electronics', 'fashion'] // Should merge/overwrite 'interests'
      },
      current_intent: 'order',
      stage: 'close'
    });
    console.log('Patched again (merge):', {
      stage: patched2?.stage,
      currentIntent: patched2?.currentIntent,
      conversationState: patched2?.conversationState
    });

    // Verify merge (lead_score should still exist, interests should be updated)
    if (patched2?.conversationState.lead_score !== 75 ||
        patched2?.conversationState.last_product_viewed !== 'product_xyz' ||
        !patched2?.conversationState.interests?.includes('fashion') ||
        patched2?.currentIntent !== 'order' ||
        patched2?.stage !== 'close') {
      throw new Error('Conversation state merge not working correctly');
    }

    // ==================== TEST 6: setConversationError ====================
    console.log('\n--- Test 6: setConversationError ---');
    const errorResult = await setConversationError(
      conversationId,
      'Test error: AI service unavailable'
    );
    console.log('Set conversation error:', {
      id: errorResult?.id,
      lastError: errorResult?.lastError
    });

    if (errorResult?.lastError !== 'Test error: AI service unavailable') {
      throw new Error('Error not set correctly');
    }

    // Verify error is stored
    const convWithError = await getOrCreateConversationHelper({
      merchantId,
      platform,
      userId
    });
    if (convWithError.lastError !== 'Test error: AI service unavailable') {
      throw new Error('Error not persisted in conversation');
    }

    // Clear error
    await setConversationError(conversationId, null as any);
    const convAfterClear = await getOrCreateConversationHelper({
      merchantId,
      platform,
      userId
    });
    if (convAfterClear.lastError !== null) {
      throw new Error('Error not cleared');
    }

    console.log('\n✅ All tests passed successfully!');

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    // Clean up: Delete created conversation and messages
    if (conversationId) {
      console.log('\n--- Cleaning up test data ---');
      await pool.query('DELETE FROM messages WHERE conversation_id = $1', [conversationId]);
      await pool.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
      console.log('Cleaned up conversation and messages for ID:', conversationId);
    }
    await pool.end();
  }
}

runTest();

