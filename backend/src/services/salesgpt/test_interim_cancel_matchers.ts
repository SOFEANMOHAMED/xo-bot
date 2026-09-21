/**
 * Unit tests for INTERIM cancel/remove verb matchers.
 * Run: npm run test-interim-cancel-matchers
 */
import {
  INTERIM_CANCEL_TEST_CASES,
  classifyInterimCancelIntent,
} from './interimCancelMatchers.js';
import { matchCartLinesForRemoval } from './cartLineRemoval.js';
import type { CartItem } from '../../core/types.js';
import { ensureLineId, removeCartLineById } from './cartLineOps.js';

let passed = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
  passed += 1;
}

for (const row of INTERIM_CANCEL_TEST_CASES) {
  const got = classifyInterimCancelIntent(row.phrase);
  assert(
    got === row.kind,
    `«${row.phrase}» → ${row.kind} (${row.note}), got ${got}`
  );
}

const watch: CartItem = ensureLineId({
  productId: 'w1',
  productName: 'ساعة',
  quantity: 1,
  unitPrice: 200,
  currency: 'SAR',
  color: 'أسود',
  addedAt: '2026-09-21T00:00:00.000Z',
});
const shirt: CartItem = ensureLineId({
  productId: 's1',
  productName: 'قميص',
  quantity: 1,
  unitPrice: 553,
  currency: 'USD',
  addedAt: '2026-09-21T00:00:01.000Z',
});
const cart = [watch, shirt];

const shirtHits = matchCartLinesForRemoval('خلص بدي الغي القميص', cart);
assert(shirtHits.length === 1 && shirtHits[0].productId === 's1', 'partial targets shirt line');

const missing = matchCartLinesForRemoval('الغي الموبايل', cart);
assert(missing.length === 0, 'absent product matches no cart line');

const after = removeCartLineById(cart, shirt.lineId!);
assert(after.length === 1 && after[0].productId === 'w1', 'removeCartLineById drops shirt only');

console.log(`✅ interim cancel matchers: ${passed} checks passed`);
