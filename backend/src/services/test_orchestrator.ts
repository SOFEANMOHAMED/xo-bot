/**
 * Test script for Orchestrator Core
 * Tests handleIncomingMessage with various scenarios
 */

import { handleIncomingMessage } from './orchestrator.service.js';
import pool from '../database/connection.js';

async function runTests() {
  console.log('Starting Orchestrator Tests...\n');
  console.log('='.repeat(80));

  // Get a test merchant (or use first merchant)
  const merchantResult = await pool.query(
    'SELECT id FROM merchants LIMIT 1'
  );

  if (merchantResult.rows.length === 0) {
    console.error('❌ No merchants found in database. Please create a merchant first.');
    process.exit(1);
  }

  const testMerchantId = merchantResult.rows[0].id;
  console.log(`Using test merchant: ${testMerchantId}\n`);

  const testCases = [
    {
      name: 'Test 1: Simple Greeting',
      params: {
        merchantId: testMerchantId,
        platform: 'telegram' as const,
        userId: 'test-user-1',
        messageText: 'مرحباً',
        userName: 'Test User'
      }
    },
    {
      name: 'Test 2: Price Inquiry',
      params: {
        merchantId: testMerchantId,
        platform: 'telegram' as const,
        userId: 'test-user-1',
        messageText: 'كم سعر الهاتف؟',
        userName: 'Test User'
      }
    },
    {
      name: 'Test 3: Product Browse',
      params: {
        merchantId: testMerchantId,
        platform: 'facebook' as const,
        userId: 'test-user-2',
        messageText: 'أريد شراء هاتف ذكي',
        userName: 'Test User 2'
      }
    },
    {
      name: 'Test 4: Shipping Inquiry',
      params: {
        merchantId: testMerchantId,
        platform: 'telegram' as const,
        userId: 'test-user-1',
        messageText: 'كم تكلفة الشحن؟',
        userName: 'Test User'
      }
    },
    {
      name: 'Test 5: Order Intent',
      params: {
        merchantId: testMerchantId,
        platform: 'telegram' as const,
        userId: 'test-user-1',
        messageText: 'أريد طلب هذا المنتج',
        userName: 'Test User'
      }
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    console.log(`\n${testCase.name}`);
    console.log('-'.repeat(80));
    console.log('Input:', JSON.stringify(testCase.params, null, 2));

    try {
      const result = await handleIncomingMessage(testCase.params);

      console.log('\n✅ Output:');
      console.log(JSON.stringify(result, null, 2));

      // Validation
      const isValid = 
        result.replyText &&
        result.replyText.length > 0 &&
        result.meta &&
        result.meta.conversationId &&
        typeof result.meta.usedFallback === 'boolean';

      // Check that reply has content
      if (isValid) {
        console.log('\n✅ Validation: PASSED');
        console.log(`   - Reply Length: ${result.replyText.length}`);
        console.log(`   - Conversation ID: ${result.meta.conversationId}`);
        console.log(`   - Intent: ${result.meta.intent}`);
        console.log(`   - Stage: ${result.meta.stage}`);
        console.log(`   - Used Fallback: ${result.meta.usedFallback}`);
        console.log(`   - Tool Results Count: ${result.meta.toolResultsCount}`);
        passed++;
      } else {
        console.log('\n❌ Validation: FAILED');
        if (!result.replyText || result.replyText.length === 0) {
          console.log('   - Error: Reply text is empty');
        }
        if (!result.meta || !result.meta.conversationId) {
          console.log('   - Error: Missing meta or conversationId');
        }
        failed++;
      }

      // Check for ONE question
      const questionCount = (result.replyText.match(/[؟?]/g) || []).length;
      if (questionCount === 1) {
        console.log('✅ Question Check: PASSED (exactly one question)');
      } else {
        console.log(`⚠️  Question Check: ${questionCount} questions found (expected 1)`);
      }

    } catch (error: any) {
      console.error(`\n❌ Error: ${error.message}`);
      console.error(error);
      failed++;
    }

    console.log('\n' + '='.repeat(80));
  }

  // Summary
  console.log('\n📊 Test Summary:');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Total: ${testCases.length}`);

  if (failed === 0) {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed');
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

