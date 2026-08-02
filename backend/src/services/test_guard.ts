/**
 * Test script for Guard Service
 * Tests quality checks for bot replies
 */

import { guardReply } from './guard.service.js';
import { SalesPlan } from './salesPlanner.js';
import { ToolResult } from './tools/tool.interface.js';

function runTests() {
  console.log('Starting Guard Service Tests...\n');
  console.log('='.repeat(80));

  const testCases: Array<{
    name: string;
    input: {
      replyText: string;
      plan: SalesPlan;
      toolResults?: ToolResult[];
      merchantPolicies?: {
        shippingPolicy?: string;
        deliveryTime?: string;
        paymentMethods?: string;
        returnPolicy?: string;
        storeCurrency?: string;
      };
    };
    expectedViolations?: string[];
    expectedWarnings?: string[];
  }> = [
    // ==================== TEST 1: Normal Reply (Should Pass) ====================
    {
      name: 'Test 1: Normal Reply (Should Pass)',
      input: {
        replyText: 'سعر الهاتف هو 500 دولار. هل تريد المتابعة مع الطلب؟',
        plan: {
          next_action: 'recommend_products',
          one_question: 'هل تريد المتابعة مع الطلب؟',
          cta_type: 'order',
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
                { id: 'p1', name: 'هاتف', price: 500, stock: 10 }
              ]
            },
            metadata: {}
          }
        ]
      },
      expectedViolations: [],
      expectedWarnings: []
    },

    // ==================== TEST 2: Too Long (Should Trim) ====================
    {
      name: 'Test 2: Too Long Reply (Should Trim)',
      input: {
        replyText: 'مرحباً بك في متجرنا. نحن نقدم مجموعة واسعة من المنتجات عالية الجودة. لدينا هواتف ذكية وأجهزة لوحية وأجهزة كمبيوتر محمولة. جميع منتجاتنا تأتي مع ضمان لمدة عام كامل. يمكننا التوصيل خلال 2-5 أيام عمل. هل تريد معرفة المزيد عن منتجاتنا؟',
        plan: {
          next_action: 'ask_clarify',
          one_question: 'ما المنتج الذي تبحث عنه؟',
          cta_type: 'choose',
          recommendation_strategy: null,
          should_offer_discount: false,
          handoff_reason: ''
        },
        toolResults: []
      },
      expectedViolations: ['Reply exceeds 120 words'],
      expectedWarnings: ['Reply trimmed']
    },

    // ==================== TEST 3: Multiple Questions (Should Fix) ====================
    {
      name: 'Test 3: Multiple Questions (Should Fix)',
      input: {
        replyText: 'لدينا هاتف ذكي بسعر 500 دولار. هل تريد معرفة المزيد؟ هل تريد الطلب الآن؟',
        plan: {
          next_action: 'recommend_products',
          one_question: 'هل تريد معرفة المزيد؟',
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
                { id: 'p1', name: 'هاتف ذكي', price: 500, stock: 10 }
              ]
            },
            metadata: {}
          }
        ]
      },
      expectedViolations: ['Reply has 2 questions (expected 1)'],
      expectedWarnings: ['Removed extra questions']
    },

    // ==================== TEST 4: No Question (Should Add) ====================
    {
      name: 'Test 4: No Question (Should Add)',
      input: {
        replyText: 'لدينا هاتف ذكي بسعر 500 دولار.',
        plan: {
          next_action: 'recommend_products',
          one_question: 'هل تريد معرفة المزيد؟',
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
                { id: 'p1', name: 'هاتف ذكي', price: 500, stock: 10 }
              ]
            },
            metadata: {}
          }
        ]
      },
      expectedViolations: ['Reply has no question'],
      expectedWarnings: ['Added planned question to reply']
    },

    // ==================== TEST 5: Hallucinated Number (Should Remove) ====================
    {
      name: 'Test 5: Hallucinated Number (Should Remove)',
      input: {
        replyText: 'سعر الهاتف هو 500 دولار. التوصيل يكلف 999 دولار. هل تريد المتابعة؟',
        plan: {
          next_action: 'recommend_products',
          one_question: 'هل تريد المتابعة؟',
          cta_type: 'order',
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
                { id: 'p1', name: 'هاتف', price: 500, stock: 10 }
              ]
            },
            metadata: {}
          }
        ],
        merchantPolicies: {
          shippingPolicy: 'التوصيل مجاني',
          storeCurrency: 'USD'
        }
      },
      expectedViolations: ['Reply contains 1 potentially hallucinated numbers: 999'],
      expectedWarnings: ['Removed sentences containing hallucinated numbers']
    },

    // ==================== TEST 6: Allowed Number from Policies ====================
    {
      name: 'Test 6: Allowed Number from Policies (Should Pass)',
      input: {
        replyText: 'التوصيل متاح خلال 3-5 أيام عمل. هل تريد المتابعة؟',
        plan: {
          next_action: 'confirm_city',
          one_question: 'هل تريد المتابعة؟',
          cta_type: 'confirm',
          recommendation_strategy: null,
          should_offer_discount: false,
          handoff_reason: ''
        },
        toolResults: [],
        merchantPolicies: {
          deliveryTime: 'التوصيل خلال 3-5 أيام عمل',
          storeCurrency: 'USD'
        }
      },
      expectedViolations: [],
      expectedWarnings: []
    },

    // ==================== TEST 7: Small Numbers (Should Pass) ====================
    {
      name: 'Test 7: Small Numbers (Should Pass)',
      input: {
        replyText: 'لدينا 3 منتجات متوفرة. هل تريد رؤيتها؟',
        plan: {
          next_action: 'recommend_products',
          one_question: 'هل تريد رؤيتها؟',
          cta_type: 'choose',
          recommendation_strategy: 'match_query',
          should_offer_discount: false,
          handoff_reason: ''
        },
        toolResults: []
      },
      expectedViolations: [],
      expectedWarnings: []
    },

    // ==================== TEST 8: Multiple Issues (All Should Be Fixed) ====================
    {
      name: 'Test 8: Multiple Issues (All Should Be Fixed)',
      input: {
        replyText: 'مرحباً بك في متجرنا. نحن نقدم مجموعة واسعة من المنتجات. سعر الهاتف هو 500 دولار. التوصيل يكلف 999 دولار. هل تريد معرفة المزيد؟ هل تريد الطلب الآن؟',
        plan: {
          next_action: 'recommend_products',
          one_question: 'هل تريد معرفة المزيد؟',
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
                { id: 'p1', name: 'هاتف', price: 500, stock: 10 }
              ]
            },
            metadata: {}
          }
        ]
      },
      expectedViolations: [
        'Reply exceeds 120 words',
        'Reply has 2 questions (expected 1)',
        'Reply contains 1 potentially hallucinated numbers: 999'
      ],
      expectedWarnings: ['Reply trimmed', 'Removed extra questions', 'Removed sentences containing hallucinated numbers']
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    console.log(`\n${testCase.name}`);
    console.log('-'.repeat(80));
    console.log('Input Reply:', testCase.input.replyText.substring(0, 100) + (testCase.input.replyText.length > 100 ? '...' : ''));
    console.log('Plan Question:', testCase.input.plan.one_question);

    try {
      const result = guardReply(testCase.input);

      console.log('\n✅ Output:');
      console.log(`   - Passed: ${result.passed}`);
      console.log(`   - Final Reply: ${result.replyText.substring(0, 100)}${result.replyText.length > 100 ? '...' : ''}`);
      console.log(`   - Violations: ${result.violations.length}`);
      console.log(`   - Warnings: ${result.warnings.length}`);

      if (result.violations.length > 0) {
        console.log(`   - Violations: ${result.violations.join(', ')}`);
      }
      if (result.warnings.length > 0) {
        console.log(`   - Warnings: ${result.warnings.join(', ')}`);
      }

      // Validation
      let isValid = true;
      let validationErrors: string[] = [];

      // Check violations match expected
      if (testCase.expectedViolations) {
        const missingViolations = testCase.expectedViolations.filter(
          v => !result.violations.some(rv => rv.includes(v) || v.includes(rv))
        );
        if (missingViolations.length > 0) {
          isValid = false;
          validationErrors.push(`Missing expected violations: ${missingViolations.join(', ')}`);
        }
      }

      // Check warnings match expected (fuzzy match)
      if (testCase.expectedWarnings) {
        const missingWarnings = testCase.expectedWarnings.filter(
          w => !result.warnings.some(rw => rw.includes(w) || w.includes(rw))
        );
        if (missingWarnings.length > 0) {
          // Warnings are optional, so we just log
          console.log(`   ⚠️  Missing expected warnings: ${missingWarnings.join(', ')}`);
        }
      }

      // Check final reply is not empty
      if (!result.replyText || result.replyText.trim().length === 0) {
        isValid = false;
        validationErrors.push('Final reply is empty');
      }

      // Check word count <= 120
      const wordCount = result.replyText.trim().split(/\s+/).length;
      if (wordCount > 120) {
        isValid = false;
        validationErrors.push(`Final reply still exceeds 120 words (${wordCount} words)`);
      }

      // Check question count = 1 (if plan has question)
      const questionCount = (result.replyText.match(/[؟?]/g) || []).length;
      if (testCase.input.plan.one_question && questionCount !== 1) {
        isValid = false;
        validationErrors.push(`Final reply has ${questionCount} questions (expected 1)`);
      }

      if (isValid && validationErrors.length === 0) {
        console.log('\n✅ Validation: PASSED');
        passed++;
      } else {
        console.log('\n❌ Validation: FAILED');
        validationErrors.forEach(err => console.log(`   - ${err}`));
        failed++;
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

