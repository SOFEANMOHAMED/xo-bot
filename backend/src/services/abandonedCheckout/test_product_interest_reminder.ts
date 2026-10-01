/**
 * Unit tests: product-interest ask detector + message builder.
 * Run: npx tsx src/services/abandonedCheckout/test_product_interest_reminder.ts
 */

import {
  extractBenefitsFromDescription,
  buildProductInterestReminderMessage,
} from './messageBuilder.js';
import {
  isExplicitProductInterestAsk,
  recordExplicitProductInterest,
} from './productInterestAsk.js';
import { pickPendingProductInterest } from './finder.js';
import type { ConversationState } from '../../core/types.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

let passed = 0;

// Explicit product asks
assert(isExplicitProductInterestAsk('شو سعر القميص'), 'price ask');
passed++;
assert(isExplicitProductInterestAsk('بدي معلومات أكثر عن المنتج'), 'info ask');
passed++;
assert(isExplicitProductInterestAsk('تفاصيل الساعة؟'), 'details ask');
passed++;
assert(!isExplicitProductInterestAsk('شو تكلفة الشحن ع المعضمية'), 'shipping is not product interest');
passed++;
assert(!isExplicitProductInterestAsk('السلام عليكم'), 'greeting is not product interest');
passed++;
assert(!isExplicitProductInterestAsk('نعم'), 'affirm is not product interest');
passed++;

// Per-product tracking
let state: ConversationState = { message_count: 1 };
state = recordExplicitProductInterest(state, 'prod-watch');
state = recordExplicitProductInterest(state, 'prod-shirt');
assert(
  Boolean(
    state.product_interest_reminder?.asked?.['prod-watch'] &&
      state.product_interest_reminder?.asked?.['prod-shirt']
  ),
  'both products recorded'
);
passed++;

const pending = pickPendingProductInterest(state);
assert(pending?.productId === 'prod-shirt', `most recent ask should be shirt, got ${pending?.productId}`);
passed++;

state = {
  ...state,
  product_interest_reminder: {
    ...state.product_interest_reminder!,
    sent: { 'prod-shirt': new Date().toISOString() },
  },
};
const pending2 = pickPendingProductInterest(state);
assert(pending2?.productId === 'prod-watch', 'after shirt sent, watch remains');
passed++;

// Benefits grounded in description only
const benefits = extractBenefitsFromDescription(
  'قماش قطني ناعم ومريح لساعات طويلة. مقاومة للتجاعيد في الاستخدام اليومي. تصميم كلاسيكي يناسب العمل.'
);
assert(benefits.length >= 2, `expected >=2 benefits, got ${benefits.length}`);
passed++;
assert(
  extractBenefitsFromDescription('').length === 0,
  'empty description yields no invented benefits'
);
passed++;

const msg = buildProductInterestReminderMessage({
  name: 'سفيان',
  productName: 'قميص',
  benefits,
  priceLabel: '553 دولار أمريكي',
});
assert(msg.includes('قميص') && msg.includes('سفيان'), 'message includes name+product');
passed++;
assert(msg.includes('553'), 'message includes price');
passed++;
assert(!/اختلق|خيالي/.test(msg), 'no fabricated filler');
passed++;

console.log(`✅ Product interest reminder tests passed: ${passed}`);
