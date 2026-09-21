/**
 * Unit tests for INTERIM cancel/remove verb matchers + variant correction.
 * Run: npm run test-interim-cancel-matchers
 */
import {
  INTERIM_CANCEL_TEST_CASES,
  INTERIM_VARIANT_CORRECTION_TEST_CASES,
  classifyInterimCancelIntent,
  isInterimVariantCorrectionIntent,
} from './interimCancelMatchers.js';
import { matchCartLinesForRemoval } from './cartLineRemoval.js';
import type { CartItem } from '../../core/types.js';
import { ensureLineId, removeCartLineById } from './cartLineOps.js';
import { resolveWantedCatalogColor } from './orderColorPolicy.js';
import { resolveVariantChange } from './resolveVariantChange.js';
import { REAL_TEST_WATCH } from './realTestCatalog.js';

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

for (const row of INTERIM_VARIANT_CORRECTION_TEST_CASES) {
  const got = isInterimVariantCorrectionIntent(row.phrase);
  assert(
    got === row.isCorrection,
    `correction «${row.phrase}» → ${row.isCorrection} (${row.note}), got ${got}`
  );
}

assert(
  resolveWantedCatalogColor('لا ما بدي اسود بدي احمر', ['أسود', 'أحمر']) === 'أحمر',
  'wanted color is positive أحمر, not negated أسود',
);
assert(
  resolveWantedCatalogColor('مو الأسود، الأحمر', ['أسود', 'أحمر']) === 'أحمر',
  'مو الأسود picks الأحمر',
);

const watchLine: CartItem = ensureLineId({
  productId: REAL_TEST_WATCH.id,
  productName: REAL_TEST_WATCH.name,
  quantity: 1,
  unitPrice: 200,
  currency: 'SAR',
  color: 'أسود',
  addedAt: '2026-09-21T00:00:00.000Z',
});

const applied = resolveVariantChange({
  messageText: 'لا ما بدي اسود بدي احمر',
  cartLines: [watchLine],
  products: [REAL_TEST_WATCH],
  focusProductId: REAL_TEST_WATCH.id,
});
assert(applied.kind === 'apply' && applied.color === 'أحمر', 'resolveVariantChange applies أحمر');

const same = resolveVariantChange({
  messageText: 'لا ما بدي اسود بدي احمر',
  cartLines: [{ ...watchLine, color: 'أحمر' }],
  products: [REAL_TEST_WATCH],
  focusProductId: REAL_TEST_WATCH.id,
});
assert(same.kind === 'unchanged' && same.color === 'أحمر', 'already-red is unchanged');

const twoSame = resolveVariantChange({
  messageText: 'غيّر للأحمر',
  cartLines: [watchLine, { ...watchLine, lineId: 'other', color: 'أسود' }],
  products: [REAL_TEST_WATCH],
  focusProductId: REAL_TEST_WATCH.id,
});
assert(twoSame.kind === 'ask_which', 'two same-product lines ask which');

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
