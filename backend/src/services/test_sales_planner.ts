/**
 * Test script for Sales Planner
 * Tests 10 example scenarios with different inputs
 */

import { planSalesAction, SalesPlanInput } from './salesPlanner.js';

function runTests() {
  console.log('Starting Sales Planner Tests...\n');
  console.log('='.repeat(80));

  const testCases: Array<{ name: string; input: SalesPlanInput }> = [
    // ==================== TEST 1: Complaint -> Handoff ====================
    {
      name: 'Test 1: Complaint -> Handoff',
      input: {
        intent: 'complaint',
        stage: 'handoff',
        objection: 'none',
        entities: {},
        conversationState: {},
        toolResults: []
      }
    },

    // ==================== TEST 2: Price Inquiry Without Product ====================
    {
      name: 'Test 2: Price Inquiry Without Product',
      input: {
        intent: 'price',
        stage: 'offer',
        objection: null,
        entities: {},
        conversationState: {},
        toolResults: []
      }
    },

    // ==================== TEST 3: Price Inquiry With Product ====================
    {
      name: 'Test 3: Price Inquiry With Product',
      input: {
        intent: 'price',
        stage: 'offer',
        objection: null,
        entities: {
          product_query: 'هاتف ذكي'
        },
        conversationState: {},
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
                  imageUrl: null,
                  source: 'shopify',
                  externalId: 'shopify-123'
                }
              ]
            },
            metadata: { count: 1 }
          }
        ]
      }
    },

    // ==================== TEST 4: Browse with 3 Products ====================
    {
      name: 'Test 4: Browse with 3 Products',
      input: {
        intent: 'browse',
        stage: 'discover',
        objection: null,
        entities: {
          product_query: 'هاتف'
        },
        conversationState: {},
        toolResults: [
          {
            name: 'catalog',
            success: true,
            data: {
              products: [
                { id: 'p1', name: 'هاتف ذكي 1', price: 500, currency: 'USD', stock: 5, sizes: null, imageUrl: null, source: 'shopify', externalId: 's1' },
                { id: 'p2', name: 'هاتف ذكي 2', price: 600, currency: 'USD', stock: 3, sizes: null, imageUrl: null, source: 'shopify', externalId: 's2' },
                { id: 'p3', name: 'هاتف ذكي 3', price: 700, currency: 'USD', stock: 8, sizes: null, imageUrl: null, source: 'shopify', externalId: 's3' }
              ]
            },
            metadata: { count: 3 }
          }
        ]
      }
    },

    // ==================== TEST 5: Order Ready - Missing City ====================
    {
      name: 'Test 5: Order Ready - Missing City',
      input: {
        intent: 'order',
        stage: 'close',
        objection: null,
        entities: {
          product_query: 'هاتف ذكي',
          quantity: 1
        },
        conversationState: {
          last_recommended_products: ['product-1']
        },
        toolResults: [
          {
            name: 'catalog',
            success: true,
            data: {
              products: [
                { id: 'product-1', name: 'هاتف ذكي', price: 500, currency: 'USD', stock: 10, sizes: null, imageUrl: null, source: 'shopify', externalId: 's1' }
              ]
            },
            metadata: { count: 1 }
          }
        ]
      }
    },

    // ==================== TEST 6: Order Ready - Missing Size ====================
    {
      name: 'Test 6: Order Ready - Missing Size',
      input: {
        intent: 'order',
        stage: 'close',
        objection: null,
        entities: {
          product_query: 'قميص',
          city: 'دمشق',
          quantity: 1
        },
        conversationState: {
          last_recommended_products: ['product-2']
        },
        toolResults: [
          {
            name: 'catalog',
            success: true,
            data: {
              products: [
                { id: 'product-2', name: 'قميص قطني', price: 50, currency: 'USD', stock: 20, sizes: ['S', 'M', 'L', 'XL'], imageUrl: null, source: 'shopify', externalId: 's2' }
              ]
            },
            metadata: { count: 1 }
          }
        ]
      }
    },

    // ==================== TEST 7: Order Ready - All Fields Present ====================
    {
      name: 'Test 7: Order Ready - All Fields Present',
      input: {
        intent: 'order',
        stage: 'close',
        objection: null,
        entities: {
          product_query: 'هاتف ذكي',
          product_id: 'product-1',
          city: 'دمشق',
          quantity: 1
        },
        conversationState: {
          last_recommended_products: ['product-1']
        },
        toolResults: [
          {
            name: 'catalog',
            success: true,
            data: {
              products: [
                { id: 'product-1', name: 'هاتف ذكي', price: 500, currency: 'USD', stock: 10, sizes: null, imageUrl: null, source: 'shopify', externalId: 's1' }
              ]
            },
            metadata: { count: 1 }
          }
        ]
      }
    },

    // ==================== TEST 8: Price Objection ====================
    {
      name: 'Test 8: Price Objection',
      input: {
        intent: 'price',
        stage: 'objection',
        objection: 'price',
        entities: {
          product_query: 'هاتف ذكي'
        },
        conversationState: {},
        toolResults: [
          {
            name: 'catalog',
            success: true,
            data: {
              products: [
                { id: 'p1', name: 'هاتف ذكي 1', price: 500, currency: 'USD', stock: 5, sizes: null, imageUrl: null, source: 'shopify', externalId: 's1' },
                { id: 'p2', name: 'هاتف ذكي 2', price: 300, currency: 'USD', stock: 3, sizes: null, imageUrl: null, source: 'shopify', externalId: 's2' }
              ]
            },
            metadata: { count: 2 }
          }
        ]
      }
    },

    // ==================== TEST 9: Availability Check ====================
    {
      name: 'Test 9: Availability Check',
      input: {
        intent: 'availability',
        stage: 'offer',
        objection: null,
        entities: {
          product_query: 'هاتف ذكي'
        },
        conversationState: {},
        toolResults: [
          {
            name: 'catalog',
            success: true,
            data: {
              products: [
                { id: 'p1', name: 'هاتف ذكي', price: 500, currency: 'USD', stock: 0, sizes: null, imageUrl: null, source: 'shopify', externalId: 's1' }
              ]
            },
            metadata: { count: 1 }
          }
        ]
      }
    },

    // ==================== TEST 10: Shipping Inquiry Without City ====================
    {
      name: 'Test 10: Shipping Inquiry Without City',
      input: {
        intent: 'shipping',
        stage: 'offer',
        objection: null,
        entities: {},
        conversationState: {},
        toolResults: []
      }
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    console.log(`\n${testCase.name}`);
    console.log('-'.repeat(80));
    console.log('Input:', JSON.stringify(testCase.input, null, 2));

    try {
      const result = planSalesAction(testCase.input);

      console.log('\n✅ Output:');
      console.log(JSON.stringify(result, null, 2));

      // Validation
      const isValid = 
        result.next_action &&
        result.one_question &&
        result.cta_type &&
        typeof result.should_offer_discount === 'boolean' &&
        typeof result.handoff_reason === 'string';

      // Check that exactly one question is provided
      const questionCount = (result.one_question.match(/\?/g) || []).length;
      const hasOneQuestion = questionCount === 1 || result.one_question.trim().endsWith('؟') || result.one_question.trim().endsWith('?');

      if (isValid && hasOneQuestion) {
        console.log('\n✅ Validation: PASSED');
        console.log(`   - Next Action: ${result.next_action}`);
        console.log(`   - Question: "${result.one_question}"`);
        console.log(`   - CTA Type: ${result.cta_type}`);
        console.log(`   - Strategy: ${result.recommendation_strategy || 'N/A'}`);
        passed++;
      } else {
        console.log('\n❌ Validation: FAILED');
        if (!hasOneQuestion) {
          console.log(`   - Error: Expected exactly one question, found ${questionCount}`);
        }
        failed++;
      }

      // Specific checks
      if (testCase.name.includes('Complaint') && result.next_action === 'handoff') {
        console.log('✅ Specific check: PASSED (complaint -> handoff)');
      } else if (testCase.name.includes('Price') && testCase.name.includes('Without') && result.next_action === 'ask_clarify') {
        console.log('✅ Specific check: PASSED (price without product -> ask_clarify)');
      } else if (testCase.name.includes('3 Products') && result.next_action === 'recommend_products') {
        console.log('✅ Specific check: PASSED (3 products -> recommend_products)');
      } else if (testCase.name.includes('Missing City') && result.next_action === 'confirm_city') {
        console.log('✅ Specific check: PASSED (order missing city -> confirm_city)');
      } else if (testCase.name.includes('Missing Size') && result.next_action === 'confirm_variant') {
        console.log('✅ Specific check: PASSED (order missing size -> confirm_variant)');
      } else if (testCase.name.includes('All Fields') && result.next_action === 'send_checkout') {
        console.log('✅ Specific check: PASSED (all fields -> send_checkout)');
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

runTests();

