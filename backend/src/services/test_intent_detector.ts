/**
 * Test script for Intent Detector
 * Tests intent detection with 5 example user messages
 */

import { detectIntentAndEntities, IntentDetectionResult } from './intentDetector.js';
import { logger } from '../utils/logger.js';

async function runTest() {
  console.log('Starting Intent Detector Test...\n');
  console.log('='.repeat(80));

  // Test cases
  const testCases = [
    {
      name: 'Test 1: Greeting',
      message: 'مرحباً، كيف حالك؟',
      recentMessages: [],
      conversationState: {},
      platform: 'facebook_messenger',
      locale: 'ar'
    },
    {
      name: 'Test 2: Price Inquiry',
      message: 'كم سعر الهاتف الذكي؟',
      recentMessages: [
        { role: 'user' as const, content: 'مرحباً' },
        { role: 'assistant' as const, content: 'مرحباً بك! كيف يمكنني مساعدتك؟' }
      ],
      conversationState: { stage: 'discover' },
      platform: 'telegram',
      locale: 'ar'
    },
    {
      name: 'Test 3: Order with Details',
      message: 'أريد شراء هاتف ذكي بحجم كبير بسعر أقل من 500 دولار في دمشق',
      recentMessages: [
        { role: 'user' as const, content: 'أريد هاتف' },
        { role: 'assistant' as const, content: 'لدينا عدة هواتف. ما الميزانية المفضلة؟' }
      ],
      conversationState: {
        current_intent: 'product_query',
        stage: 'offer',
        last_recommended_products: ['product-uuid-123']
      },
      platform: 'web',
      locale: 'ar'
    },
    {
      name: 'Test 4: Complaint',
      message: 'المنتج الذي وصلني تالف، أنا غاضب جداً!',
      recentMessages: [
        { role: 'user' as const, content: 'أريد إرجاع المنتج' },
        { role: 'assistant' as const, content: 'نعتذر عن المشكلة. يمكنك إرجاع المنتج خلال 7 أيام.' }
      ],
      conversationState: {
        current_intent: 'order',
        stage: 'close'
      },
      platform: 'facebook_messenger',
      locale: 'ar'
    },
    {
      name: 'Test 5: Shipping Inquiry',
      message: 'متى يوصل المنتج إلى حلب؟',
      recentMessages: [
        { role: 'user' as const, content: 'أريد شراء هذا المنتج' },
        { role: 'assistant' as const, content: 'ممتاز! المنتج متوفر. هل تريد المتابعة مع الطلب؟' }
      ],
      conversationState: {
        current_intent: 'order',
        stage: 'close',
        last_recommended_products: ['product-uuid-456']
      },
      platform: 'telegram',
      locale: 'ar'
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    console.log(`\n${testCase.name}`);
    console.log('-'.repeat(80));
    console.log(`Message: "${testCase.message}"`);
    console.log(`Platform: ${testCase.platform}`);
    console.log(`Locale: ${testCase.locale}`);
    console.log(`Recent Messages: ${testCase.recentMessages.length}`);
    console.log(`Conversation State: ${JSON.stringify(testCase.conversationState, null, 2)}`);

    try {
      const result: IntentDetectionResult = await detectIntentAndEntities({
        messageText: testCase.message,
        recentMessages: testCase.recentMessages,
        conversationState: testCase.conversationState,
        platform: testCase.platform,
        locale: testCase.locale
      });

      console.log('\n✅ Result:');
      console.log(JSON.stringify(result, null, 2));

      // Basic validation
      const isValid = 
        result.intent &&
        result.stage &&
        typeof result.confidence === 'number' &&
        result.confidence >= 0 &&
        result.confidence <= 1 &&
        Array.isArray(result.missing_fields) &&
        typeof result.entities === 'object';

      if (isValid) {
        console.log('\n✅ Validation: PASSED');
        passed++;
      } else {
        console.log('\n❌ Validation: FAILED');
        failed++;
      }

      // Specific checks for each test case
      if (testCase.name.includes('Greeting') && result.intent === 'greeting') {
        console.log('✅ Intent check: PASSED (greeting detected)');
      } else if (testCase.name.includes('Price') && result.intent === 'price') {
        console.log('✅ Intent check: PASSED (price detected)');
      } else if (testCase.name.includes('Order') && result.intent === 'order') {
        console.log('✅ Intent check: PASSED (order detected)');
      } else if (testCase.name.includes('Complaint') && result.intent === 'complaint' && result.stage === 'handoff') {
        console.log('✅ Intent check: PASSED (complaint -> handoff)');
      } else if (testCase.name.includes('Shipping') && result.intent === 'shipping') {
        console.log('✅ Intent check: PASSED (shipping detected)');
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

runTest().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

