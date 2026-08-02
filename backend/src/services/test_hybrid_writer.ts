/**
 * Test script for Hybrid Sales Writer
 * Tests 5 example scenarios with different inputs
 */

import { generateSalesReply, HybridWriterInput } from './hybridWriter.js';

async function runTests() {
  console.log('Starting Hybrid Sales Writer Tests...\n');
  console.log('='.repeat(80));

  const testCases: Array<{ name: string; input: HybridWriterInput }> = [
    // ==================== TEST 1: Greeting ====================
    {
      name: 'Test 1: Greeting',
      input: {
        merchantId: 'test-merchant-1',
        platform: 'telegram',
        messageText: 'مرحباً',
        recentMessages: [
          { role: 'user', content: 'مرحباً' }
        ],
        detection: {
          intent: 'browse',
          stage: 'discover',
          objection: null,
          entities: {},
          missing_fields: []
        },
        plan: {
          next_action: 'ask_clarify',
          one_question: 'مرحباً بك! كيف يمكنني مساعدتك اليوم؟',
          cta_type: 'choose',
          recommendation_strategy: null,
          should_offer_discount: false,
          handoff_reason: ''
        },
        toolResults: [],
        conversationState: {},
        merchantPolicies: {
          storeName: 'متجر الأجهزة الذكية',
          storeCurrency: 'USD',
          persona: 'friendly'
        }
      }
    },

    // ==================== TEST 2: Price Question ====================
    {
      name: 'Test 2: Price Question',
      input: {
        merchantId: 'test-merchant-1',
        platform: 'telegram',
        messageText: 'كم سعر الهاتف الذكي؟',
        recentMessages: [
          { role: 'user', content: 'مرحباً' },
          { role: 'assistant', content: 'مرحباً بك! كيف يمكنني مساعدتك اليوم؟' },
          { role: 'user', content: 'كم سعر الهاتف الذكي؟' }
        ],
        detection: {
          intent: 'price',
          stage: 'offer',
          objection: null,
          entities: {
            product_query: 'هاتف ذكي'
          },
          missing_fields: []
        },
        plan: {
          next_action: 'recommend_products',
          one_question: 'هل تريد معرفة المزيد عن هذا المنتج؟',
          cta_type: 'choose',
          recommendation_strategy: 'match_query',
          should_offer_discount: false,
          handoff_reason: ''
        },
        toolResults: [
          {
            name: 'catalog',
            success: true,
            data: {
              products: [
                {
                  id: 'product-1',
                  name: 'هاتف ذكي',
                  price: 500,
                  currency: 'USD',
                  stock: 10,
                  sizes: null,
                  description: 'هاتف ذكي بمواصفات عالية',
                  imageUrl: null,
                  source: 'shopify',
                  externalId: 'shopify-123'
                }
              ]
            },
            metadata: { count: 1 }
          }
        ],
        conversationState: {},
        merchantPolicies: {
          storeName: 'متجر الأجهزة الذكية',
          storeCurrency: 'USD',
          persona: 'sales'
        }
      }
    },

    // ==================== TEST 3: Shipping Question ====================
    {
      name: 'Test 3: Shipping Question',
      input: {
        merchantId: 'test-merchant-1',
        platform: 'telegram',
        messageText: 'كم تكلفة الشحن؟',
        recentMessages: [
          { role: 'user', content: 'كم تكلفة الشحن؟' }
        ],
        detection: {
          intent: 'shipping',
          stage: 'offer',
          objection: null,
          entities: {},
          missing_fields: []
        },
        plan: {
          next_action: 'confirm_city',
          one_question: 'إلى أي مدينة تريد التوصيل؟',
          cta_type: 'confirm',
          recommendation_strategy: null,
          should_offer_discount: false,
          handoff_reason: ''
        },
        toolResults: [],
        conversationState: {},
        merchantPolicies: {
          storeName: 'متجر الأجهزة الذكية',
          storeCurrency: 'USD',
          shippingPolicy: 'الشحن مجاني للطلبات فوق 100 دولار',
          deliveryTime: '3-5 أيام عمل',
          persona: 'friendly'
        }
      }
    },

    // ==================== TEST 4: "Too Expensive" Objection ====================
    {
      name: 'Test 4: "Too Expensive" Objection',
      input: {
        merchantId: 'test-merchant-1',
        platform: 'telegram',
        messageText: 'غالي جداً',
        recentMessages: [
          { role: 'user', content: 'كم سعر الهاتف الذكي؟' },
          { role: 'assistant', content: 'هاتف ذكي بسعر 500 دولار' },
          { role: 'user', content: 'غالي جداً' }
        ],
        detection: {
          intent: 'price',
          stage: 'objection',
          objection: 'price',
          entities: {
            product_query: 'هاتف ذكي'
          },
          missing_fields: []
        },
        plan: {
          next_action: 'ask_clarify',
          one_question: 'ما الميزانية المفضلة لديك؟',
          cta_type: 'choose',
          recommendation_strategy: null,
          should_offer_discount: true,
          handoff_reason: ''
        },
        toolResults: [
          {
            name: 'catalog',
            success: true,
            data: {
              products: [
                {
                  id: 'product-1',
                  name: 'هاتف ذكي',
                  price: 500,
                  currency: 'USD',
                  stock: 10,
                  sizes: null,
                  description: 'هاتف ذكي بمواصفات عالية',
                  imageUrl: null,
                  source: 'shopify',
                  externalId: 'shopify-123'
                },
                {
                  id: 'product-2',
                  name: 'هاتف ذكي اقتصادي',
                  price: 300,
                  currency: 'USD',
                  stock: 5,
                  sizes: null,
                  description: 'هاتف ذكي بمواصفات جيدة',
                  imageUrl: null,
                  source: 'shopify',
                  externalId: 'shopify-456'
                }
              ]
            },
            metadata: { count: 2 }
          }
        ],
        conversationState: {
          last_recommended_products: ['product-1']
        },
        merchantPolicies: {
          storeName: 'متجر الأجهزة الذكية',
          storeCurrency: 'USD',
          persona: 'sales'
        }
      }
    },

    // ==================== TEST 5: "I Want to Order" ====================
    {
      name: 'Test 5: "I Want to Order"',
      input: {
        merchantId: 'test-merchant-1',
        platform: 'telegram',
        messageText: 'أريد طلب الهاتف الذكي',
        recentMessages: [
          { role: 'user', content: 'كم سعر الهاتف الذكي؟' },
          { role: 'assistant', content: 'هاتف ذكي بسعر 500 دولار' },
          { role: 'user', content: 'أريد طلب الهاتف الذكي' }
        ],
        detection: {
          intent: 'order',
          stage: 'close',
          objection: null,
          entities: {
            product_query: 'هاتف ذكي',
            quantity: 1
          },
          missing_fields: ['city']
        },
        plan: {
          next_action: 'confirm_city',
          one_question: 'إلى أي مدينة تريد التوصيل؟',
          cta_type: 'confirm',
          recommendation_strategy: null,
          should_offer_discount: false,
          handoff_reason: ''
        },
        toolResults: [
          {
            name: 'catalog',
            success: true,
            data: {
              products: [
                {
                  id: 'product-1',
                  name: 'هاتف ذكي',
                  price: 500,
                  currency: 'USD',
                  stock: 10,
                  sizes: null,
                  description: 'هاتف ذكي بمواصفات عالية',
                  imageUrl: null,
                  source: 'shopify',
                  externalId: 'shopify-123'
                }
              ]
            },
            metadata: { count: 1 }
          }
        ],
        conversationState: {
          last_recommended_products: ['product-1']
        },
        merchantPolicies: {
          storeName: 'متجر الأجهزة الذكية',
          storeCurrency: 'USD',
          shippingPolicy: 'الشحن مجاني للطلبات فوق 100 دولار',
          deliveryTime: '3-5 أيام عمل',
          paymentMethods: 'نقد عند الاستلام، بطاقة ائتمانية',
          returnPolicy: 'يمكن الإرجاع خلال 14 يوم',
          persona: 'sales'
        }
      }
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    console.log(`\n${testCase.name}`);
    console.log('-'.repeat(80));
    console.log('Input:', JSON.stringify({
      intent: testCase.input.detection.intent,
      stage: testCase.input.detection.stage,
      nextAction: testCase.input.plan.next_action,
      oneQuestion: testCase.input.plan.one_question,
      productsCount: testCase.input.toolResults?.find(r => r.name === 'catalog')?.data?.products?.length || 0
    }, null, 2));

    try {
      const result = await generateSalesReply(testCase.input);

      console.log('\n✅ Output:');
      console.log(result);
      console.log(`\n📊 Stats:`);
      console.log(`   - Length: ${result.length} characters`);
      console.log(`   - Word count: ${result.split(/\s+/).length} words`);
      console.log(`   - Contains question mark: ${result.includes('؟') || result.includes('?')}`);
      console.log(`   - Contains required question: ${result.includes(testCase.input.plan.one_question)}`);

      // Validation
      const wordCount = result.split(/\s+/).length;
      const hasQuestion = result.includes('؟') || result.includes('?');
      const containsRequiredQuestion = result.includes(testCase.input.plan.one_question);
      const isArabic = (result.match(/[\u0600-\u06FF]/g) || []).length / result.length > 0.3;

      const isValid = 
        wordCount <= 120 &&
        hasQuestion &&
        isArabic &&
        result.length > 10;

      if (isValid) {
        console.log('\n✅ Validation: PASSED');
        console.log(`   - Word count: ${wordCount} (max 120)`);
        console.log(`   - Has question: ${hasQuestion}`);
        console.log(`   - Is Arabic: ${isArabic}`);
        passed++;
      } else {
        console.log('\n❌ Validation: FAILED');
        if (wordCount > 120) {
          console.log(`   - Error: Word count ${wordCount} exceeds 120`);
        }
        if (!hasQuestion) {
          console.log(`   - Error: No question mark found`);
        }
        if (!isArabic) {
          console.log(`   - Error: Response seems non-Arabic`);
        }
        failed++;
      }

      // Specific checks
      if (testCase.name.includes('Greeting') && result.includes('مرحباً')) {
        console.log('✅ Specific check: PASSED (greeting detected)');
      } else if (testCase.name.includes('Price') && (result.includes('500') || result.includes('دولار'))) {
        console.log('✅ Specific check: PASSED (price mentioned)');
      } else if (testCase.name.includes('Shipping') && result.includes('مدينة')) {
        console.log('✅ Specific check: PASSED (city question)');
      } else if (testCase.name.includes('Expensive') && (result.includes('ميزانية') || result.includes('بديل'))) {
        console.log('✅ Specific check: PASSED (objection handling)');
      } else if (testCase.name.includes('Order') && result.includes('مدينة')) {
        console.log('✅ Specific check: PASSED (order confirmation)');
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

runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

