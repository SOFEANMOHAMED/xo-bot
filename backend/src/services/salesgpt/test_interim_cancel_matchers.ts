/**
 * Unit tests for INTERIM cancel/remove verb matchers + variant correction + product negation.
 * Run: npm run test-interim-cancel-matchers
 */
import {
  INTERIM_CANCEL_TEST_CASES,
  INTERIM_VARIANT_CORRECTION_TEST_CASES,
  classifyInterimCancelIntent,
  isInterimVariantCorrectionIntent,
} from './interimCancelMatchers.js';
import {
  isProductNameNegatedInMessage,
  matchCartLinesForProductNegation,
  matchCartLinesForRemoval,
} from './cartLineRemoval.js';
import type { CartItem, Product } from '../../core/types.js';
import { ensureLineId, removeCartLineById } from './cartLineOps.js';
import { resolveWantedCatalogColor } from './orderColorPolicy.js';
import { resolveVariantChange } from './resolveVariantChange.js';
import { REAL_TEST_WATCH } from './realTestCatalog.js';
import { applyInterpreterResult } from './interpreter/apply.js';
import { matchWhitelist } from './interpreter/whitelist.js';
import type { InterpreterInput } from './interpreter/types.js';

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

// ——— Product negation («بدي القميص مو الساعة») ———
assert(
  isProductNameNegatedInMessage('بدي القميص مو الساعة', 'ساعة'),
  'مو الساعة negates ساعة'
);
assert(
  !isProductNameNegatedInMessage('بدي القميص مو الساعة', 'قميص'),
  'مو الساعة does not negate قميص'
);
assert(
  isProductNameNegatedInMessage('ما بدي الساعة يا حيوان', 'ساعة'),
  'ما بدي الساعة negates ساعة'
);

const negHits = matchCartLinesForProductNegation('بدي القميص مو الساعة', cart);
assert(
  negHits.length === 1 && negHits[0].productId === 'w1',
  'product negation matches watch line only'
);

const shirtProduct: Product = {
  id: 's1',
  name: 'قميص',
  price: 553,
  currency: 'USD',
  stock: 10,
};
const watchProduct: Product = {
  id: 'w1',
  name: 'ساعة',
  price: 200,
  currency: 'SAR',
  stock: 5,
  colors: ['أسود', 'أحمر'],
};

const whitelistInput: InterpreterInput = {
  message: 'بدي القميص مو الساعة',
  recentMessages: [],
  allowedProductIds: ['w1', 's1'],
  cartLines: [
    {
      lineId: watch.lineId!,
      productId: 'w1',
      productName: 'ساعة',
      color: 'أسود',
      size: null,
      quantity: 1,
      currency: 'SAR',
      allowedColors: ['أسود', 'أحمر'],
      allowedSizes: [],
    },
    {
      lineId: shirt.lineId!,
      productId: 's1',
      productName: 'قميص',
      color: null,
      size: null,
      quantity: 1,
      currency: 'USD',
      allowedColors: [],
      allowedSizes: [],
    },
  ],
  stateSummary: {
    focusProductId: 'w1',
    pendingBotQuestion: null,
    pendingProductId: null,
    awaitingOrderConfirmation: false,
    cartStatus: 'building',
  },
};

const wl = matchWhitelist(whitelistInput);
assert(!!wl, 'whitelist matches product negation');
assert(
  wl!.actions.length === 1 &&
    wl!.actions[0].type === 'remove_line' &&
    wl!.actions[0].productId === 'w1' &&
    wl!.actions[0].evidence === 'product_negation',
  'whitelist emits remove_line for negated watch'
);

const appliedNeg = applyInterpreterResult({
  result: wl!,
  state: {
    message_count: 1,
    cart: { status: 'building', items: cart },
    extracted_entities: { product_id: 'w1', product_query: 'ساعة' },
  },
  productsById: new Map([
    ['w1', watchProduct],
    ['s1', shirtProduct],
  ]),
});
const remainingIds = (appliedNeg.state.cart?.items || []).map((i) => i.productId);
assert(
  remainingIds.length === 1 && remainingIds[0] === 's1',
  `after negation cart must be shirt-only, got ${remainingIds.join(',')}`
);
assert(appliedNeg.applied.includes('remove_line'), 'remove_line was applied');

console.log(`✅ interim cancel matchers: ${passed} checks passed`);
