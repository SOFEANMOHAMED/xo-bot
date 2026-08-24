/**
 * Conversation cart merge policy.
 * Run: npm run test-conversation-cart
 *
 * Guards the multi-SKU bug: colorless watch + shirt in cart, then draft
 * watch+color, must fill the existing line — never append a third SKU.
 */

import type { CartItem, ConversationState, Product } from '../../core/types.js';
import {
  addItemToCart,
  ensureCartForCheckout,
  fillCartVariantsFromDraft,
  getCartItems,
  isCheckoutReady,
  lockDraftIntoCart,
  replaceCartItems,
} from './conversationCart.js';

const WATCH_ID = 'aaaaaaaa-1111-4000-8000-000000000001';
const SHIRT_ID = 'bbbbbbbb-2222-4000-8000-000000000002';

const watchProduct: Product = {
  id: WATCH_ID,
  name: 'ساعات',
  price: 200,
  currency: 'USD',
  stock: 10,
  colors: ['أسود', 'أبيض'],
};

const shirtProduct: Product = {
  id: SHIRT_ID,
  name: 'قميص',
  price: 553,
  currency: 'USD',
  stock: 10,
};

function line(partial: Partial<CartItem> & Pick<CartItem, 'productId' | 'productName' | 'unitPrice'>): CartItem {
  return {
    quantity: 1,
    currency: 'USD',
    addedAt: '2026-08-23T00:00:00.000Z',
    ...partial,
  };
}

function state(partial: Partial<ConversationState>): ConversationState {
  return {
    message_count: 1,
    ...partial,
  };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

let passed = 0;

function run(): void {
  // 1) Live bug: cart [ساعات no color, قميص] + leftover draft ساعات+اسود
  //    at checkout → 2 lines, watch colored, no third line.
  const bugState = state({
    extracted_entities: {
      name: 'أحمد',
      phone: '0991122333',
      address: 'دمشق',
      product_id: WATCH_ID,
      product_query: 'ساعات',
      color: 'اسود',
      quantity: 1,
    },
    cart: {
      status: 'building',
      items: [
        line({ productId: WATCH_ID, productName: 'ساعات', unitPrice: 200 }),
        line({ productId: SHIRT_ID, productName: 'قميص', unitPrice: 553 }),
      ],
    },
  });

  const checkedOut = ensureCartForCheckout(bugState, watchProduct, 'USD');
  const checkoutItems = getCartItems(checkedOut);
  assert(checkoutItems.length === 2, `checkout must stay at 2 lines, got ${checkoutItems.length}`);
  const watchLine = checkoutItems.find((item) => item.productId === WATCH_ID);
  const shirtLine = checkoutItems.find((item) => item.productId === SHIRT_ID);
  assert(!!watchLine && !!shirtLine, 'both SKUs present');
  assert(watchLine?.color === 'أسود', `watch color canonicalized, got ${watchLine?.color}`);
  assert(!shirtLine?.color, 'shirt must not inherit watch color');
  assert(
    checkoutItems.filter((item) => item.productId === WATCH_ID).length === 1,
    'must not duplicate the watch'
  );
  passed++;

  // 2) Repeat confirm is idempotent.
  const again = ensureCartForCheckout(
    {
      ...checkedOut,
      extracted_entities: {
        ...(checkedOut.extracted_entities || {}),
        product_id: WATCH_ID,
        product_query: 'ساعات',
        color: 'اسود',
      },
    },
    watchProduct,
    'USD'
  );
  assert(getCartItems(again).length === 2, 'repeat checkout still 2 lines');
  passed++;

  // 3) Explicit add of a second fully-specified variant → new line.
  const blackCart = state({
    extracted_entities: {
      product_id: WATCH_ID,
      product_query: 'ساعات',
      color: 'أبيض',
      quantity: 1,
    },
    cart: {
      status: 'building',
      items: [
        line({ productId: WATCH_ID, productName: 'ساعات', unitPrice: 200, color: 'أسود' }),
      ],
    },
  });
  const lockedWhite = lockDraftIntoCart(blackCart, watchProduct, 'USD');
  assert(lockedWhite.locked, 'white watch must lock');
  const variantItems = getCartItems(lockedWhite.state);
  assert(variantItems.length === 2, `two watch variants, got ${variantItems.length}`);
  const colors = variantItems.map((item) => item.color).sort();
  assert(colors[0] === 'أبيض' && colors[1] === 'أسود', `expected أسود+أبيض, got ${colors.join(',')}`);
  passed++;

  // 4) أسود vs اسود is the same option — one line after catalog match.
  const mixedSpell = addItemToCart(
    { status: 'building', items: [line({ productId: WATCH_ID, productName: 'ساعات', unitPrice: 200, color: 'أسود' })] },
    line({ productId: WATCH_ID, productName: 'ساعات', unitPrice: 200, color: 'اسود' }),
    'set'
  );
  assert(mixedSpell.items.length === 1, 'equivalent colors merge to one line');
  passed++;

  // 5) Empty cart + complete draft → first line.
  const emptyDraft = state({
    extracted_entities: {
      name: 'سارة',
      phone: '099',
      address: 'حلب',
      product_id: WATCH_ID,
      product_query: 'ساعات',
      color: 'أسود',
      quantity: 1,
    },
  });
  const firstLock = ensureCartForCheckout(emptyDraft, watchProduct, 'USD');
  const firstItems = getCartItems(firstLock);
  assert(firstItems.length === 1, 'empty cart promotes draft');
  assert(firstItems[0].productId === WATCH_ID, 'promoted watch');
  assert(firstItems[0].color === 'أسود', 'promoted color');
  passed++;

  // 6) Mid-conversation fill writes color without adding SKUs or clearing draft.
  const mid = fillCartVariantsFromDraft(
    state({
      extracted_entities: {
        product_id: WATCH_ID,
        color: 'اسود',
      },
      cart: {
        status: 'building',
        items: [
          line({ productId: WATCH_ID, productName: 'ساعات', unitPrice: 200 }),
          line({ productId: SHIRT_ID, productName: 'قميص', unitPrice: 553 }),
        ],
      },
    }),
    watchProduct
  );
  const midItems = getCartItems(mid);
  assert(midItems.length === 2, 'fill never appends');
  assert(midItems.find((item) => item.productId === WATCH_ID)?.color === 'أسود', 'fill writes catalog color');
  assert(mid.extracted_entities?.color === 'اسود', 'fill keeps draft entities');
  passed++;

  // 7) replaceCartItems keeps previously locked color on colorless rebuild.
  const preserved = replaceCartItems(
    state({
      cart: {
        status: 'building',
        items: [
          line({ productId: WATCH_ID, productName: 'ساعات', unitPrice: 200, color: 'أسود' }),
          line({ productId: SHIRT_ID, productName: 'قميص', unitPrice: 553 }),
        ],
      },
    }),
    [
      line({ productId: WATCH_ID, productName: 'ساعات', unitPrice: 200 }),
      line({ productId: SHIRT_ID, productName: 'قميص', unitPrice: 553 }),
    ]
  );
  assert(getCartItems(preserved).find((item) => item.productId === WATCH_ID)?.color === 'أسود', 'replace keeps color');
  passed++;

  // 8) Checkout is not ready while the focused colored SKU has a blank variant.
  const notReady = isCheckoutReady(
    state({
      extracted_entities: {
        name: 'أحمد',
        phone: '099',
        address: 'دمشق',
      },
      cart: {
        status: 'building',
        items: [
          line({ productId: WATCH_ID, productName: 'ساعات', unitPrice: 200 }),
          line({ productId: SHIRT_ID, productName: 'قميص', unitPrice: 553 }),
        ],
      },
    }),
    watchProduct
  );
  assert(!notReady.complete, 'color still required when cart has a colorless watch');
  assert(notReady.missing.includes('color'), `missing color, got ${notReady.missing.join(',')}`);

  const ready = isCheckoutReady(
    state({
      extracted_entities: {
        name: 'أحمد',
        phone: '099',
        address: 'دمشق',
        color: 'اسود',
      },
      cart: {
        status: 'building',
        items: [
          line({ productId: WATCH_ID, productName: 'ساعات', unitPrice: 200 }),
          line({ productId: SHIRT_ID, productName: 'قميص', unitPrice: 553 }),
        ],
      },
    }),
    watchProduct
  );
  assert(ready.complete, 'color on entities satisfies the watch line');
  passed++;

  // Shirt-only focus does not demand watch color.
  const shirtReady = isCheckoutReady(
    state({
      extracted_entities: {
        name: 'أحمد',
        phone: '099',
        address: 'دمشق',
      },
      cart: {
        status: 'building',
        items: [line({ productId: SHIRT_ID, productName: 'قميص', unitPrice: 553 })],
      },
    }),
    shirtProduct
  );
  assert(shirtReady.complete, 'shirt without colors is checkout-ready');
  passed++;

  console.log(`✅ conversation cart merge policy: ${passed} checks passed`);
}

run();
