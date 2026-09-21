/**
 * Test script for hybrid orchestrator conversation helpers
 * Tests: getOrCreateConversationHelper, appendMessage, patchConversationState, getRecentMessages, setConversationError
 *
 * Uses a throwaway merchant on xobot_test — never a hardcoded or LIMIT 1 production id.
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
import {
  assertIsolatedTestDb,
  deleteThrowawayMerchant,
  endPoolAndExit,
  insertThrowawayMerchant,
} from './testDbFixtures.js';

function exitCodeFromProcess(): number {
  return process.exitCode === 1 ? 1 : 0;
}

async function runTest() {
  assertIsolatedTestDb();
  const platform = 'test_platform';
  const userId = crypto.randomBytes(16).toString('hex');
  const userName = 'Test User';

  let merchantId: string | undefined;
  let conversationId: string | null = null;

  try {
    merchantId = await insertThrowawayMerchant(pool, 'hybrid_orchestrator');
    if (!merchantId) {
      throw new Error('Failed to create throwaway merchant');
    }
    console.log('Starting hybrid orchestrator helpers tests...');
    console.log('Test parameters:', { merchantId, platform, userId, userName });
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

    // SQL is ORDER BY created_at DESC (newest first). Comment in the helper
    // says oldest→newest but the query is not reversed — assert actual SQL.
    if (recentMessages[0].role !== 'assistant' || recentMessages[1].role !== 'user') {
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

    // last_error is nullable in SQL; the helper is typed as string only.
    await setConversationError(conversationId, null as unknown as string);
    const convAfterClear = await getOrCreateConversationHelper({
      merchantId,
      platform,
      userId
    });
    if (convAfterClear.lastError !== null) {
      throw new Error('Error not cleared');
    }

    console.log('\n✅ All tests passed successfully!');

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('\n❌ Test failed:', message);
    console.error(error);
    process.exitCode = 1;
  } finally {
    try {
      if (merchantId) {
        console.log('\n--- Cleaning up throwaway merchant ---');
        await deleteThrowawayMerchant(pool, merchantId);
        console.log('Deleted throwaway merchant:', merchantId);
      }
    } catch (cleanupError: unknown) {
      const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      console.error('Throwaway merchant cleanup failed:', message);
      process.exitCode = 1;
    }
    await endPoolAndExit(pool, exitCodeFromProcess());
  }
}

runTest();

