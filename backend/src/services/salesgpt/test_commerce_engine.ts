/**
 * Cart-as-Truth commerce engine contract tests reconstructed from the backup.
 * The production module is optional in this source snapshot, so it is loaded
 * dynamically: independent cart/policy checks still run and absence is a
 * visible KNOWN_PENDING failure, never a silent skip.
 */
import type { CartItem, ConversationState, Language, Product } from '../../core/types.js';
import { formatCartSummary } from './conversationCart.js';
import {
  customerCancelsOrder,
  normalizeArabic,
  shouldAppendOrderData,
} from './orderConfirmationPolicy.js';

type CartPhase = 'configuring' | 'awaiting_confirm' | 'cancelled' | 'confirmed';
type CartState = {
  lines: CartItem[];
  identity: { name?: string; phone?: string; address?: string };
  phase: CartPhase;
  focusProductId?: string;
};
type CommerceEvent =
  | { type: 'Confirm' }
  | { type: 'RequestConfirm' }
  | { type: 'AddOrFocusProduct'; product: Product; color?: string; currency?: string }
  | { type: 'SetVariant'; productId: string; color?: string; size?: string; product: Product }
  | { type: string; [key: string]: unknown };
type Reduction = {
  applied: boolean;
  mutated: boolean;
  reason: string;
  nextAction?: string;
  state: CartState;
};
type Rendered = { replyText?: string };
type CommerceApi = {
  applyCartStateToConversation: (state: ConversationState, cart: CartState) => ConversationState;
  cartStateFromConversation: (state: ConversationState) => CartState;
  classifyCommerceEvent: (input: {
    messageText: string;
    cart: CartState;
    mentionedProducts: Product[];
    focusProduct?: Product;
    wantsAddAnother?: boolean;
    botAskedConfirm?: boolean;
  }) => CommerceEvent;
  enforceCartTruthReply: (input: {
    replyText: string;
    before: CartState;
    after: CartState;
    mutated: boolean;
    language: Language;
    fallbackNextAction: string;
  }) => { replyText: string; strippedFalseClaim: boolean };
  reduceCommerce: (cart: CartState, event: CommerceEvent) => Reduction;
  renderCommerceReply: (
    before: CartState,
    after: CartState,
    reduction: Reduction,
    language: Language,
    event: CommerceEvent,
  ) => Rendered;
  replyClaimsCartAdd: (reply: string) => boolean;
};

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(message);
  }
}

const watch: Product = {
  id: 'watch-1',
  name: 'ساعة',
  price: 202,
  currency: 'SAR',
  stock: 5,
  colors: ['أحمر', 'أسود'],
  sizes: [],
  description: 'ساعة',
  imageUrl: '',
  category: '',
};
const shirt: Product = {
  id: 'shirt-1',
  name: 'قميص',
  price: 553,
  currency: 'SAR',
  stock: 5,
  colors: ['أحمر', 'أسود'],
  sizes: ['M', 'L'],
  description: 'قميص',
  imageUrl: '',
  category: '',
};

function line(product: Product, color?: string): CartItem {
  return {
    productId: product.id,
    productName: product.name,
    quantity: 1,
    unitPrice: product.price,
    currency: product.currency,
    color,
    addedAt: '2026-09-20T00:00:00.000Z',
  };
}

function withWatchInCart(): CartState {
  return {
    lines: [line(watch, 'أحمر')],
    identity: { name: 'Sufyan', phone: '09552222', address: 'Damascus' },
    phase: 'awaiting_confirm',
    focusProductId: watch.id,
  };
}

// These policy checks do not depend on the pending commerce module.
assert(!customerCancelsOrder('لا بدياها لون أحمر'), 'variant correction is not cancel');
assert(customerCancelsOrder('لا بدي'), 'bare لا بدي still cancels');
assert(customerCancelsOrder('إلغاء الطلب'), 'explicit cancel still works');
try {
  const policyPath = './orderConfirmationPolicy.js';
  const policy = await import(policyPath) as unknown as Record<string, unknown>;
  const detectsCorrection = policy.isVariantCorrectionIntent;
  assert(
    typeof detectsCorrection === 'function' &&
      (detectsCorrection as (text: string) => boolean)('لا بدياها لون أحمر'),
    'detects variant correction',
  );
} catch (error: unknown) {
  assert(false, `variant-correction helper unavailable: ${error instanceof Error ? error.message : String(error)}`);
}

const directSummary = formatCartSummary([line(watch, 'أحمر'), line(shirt, 'أحمر')], 'arabic');
assert(/ساعة/.test(directSummary) && /قميص/.test(directSummary), 'summary lists both products');
assert(/202/.test(directSummary) && /553/.test(directSummary), 'summary shows both unit prices');
assert(/مجموع المنتجات: 755/.test(directSummary), 'summary subtotal is the sum of line totals');

let commerce: CommerceApi | null = null;
try {
  const modulePath = './commerceEngine.js';
  commerce = await import(modulePath) as CommerceApi;
} catch (error: unknown) {
  const reason = error instanceof Error ? error.message : String(error);
  assert(false, `commerceEngine module unavailable: ${reason}`);
}

if (commerce) {
  assert(commerce.replyClaimsCartAdd('تمت إضافة قميص إلى سلتك'), 'detects Arabic add claim');

  {
    const before = withWatchInCart();
    const truth = commerce.enforceCartTruthReply({
      replyText: '✅ تمت إضافة قميص إلى سلتك\n• قميص – احمر × 1',
      before,
      after: before,
      mutated: false,
      language: 'arabic',
      fallbackNextAction: 'add_to_cart',
    });
    assert(truth.strippedFalseClaim, 'freeze strips a false add claim');
    assert(
      !commerce.replyClaimsCartAdd(truth.replyText) || /ما قدرت/.test(truth.replyText),
      'freeze returns honest copy',
    );
  }

  {
    const before = withWatchInCart();
    const after: CartState = {
      ...before,
      lines: before.lines.map((item) => ({ ...item, color: 'أسود' })),
      phase: 'configuring',
    };
    const truth = commerce.enforceCartTruthReply({
      replyText: 'تمام، حدّثت طلبك.\n• ساعة — أسود — 202 ريال سعودي',
      before,
      after,
      mutated: false,
      language: 'arabic',
      fallbackNextAction: 'present_product',
    });
    assert(!truth.strippedFalseClaim, 'real variant update is not frozen');
  }

  {
    const configuring: CartState = { ...withWatchInCart(), phase: 'configuring' };
    const rejected = commerce.reduceCommerce(configuring, { type: 'Confirm' });
    assert(!rejected.applied, 'confirm rejected outside awaiting');
    assert(rejected.reason === 'confirm_outside_awaiting', rejected.reason);

    const awaiting = withWatchInCart();
    const confirmed = commerce.reduceCommerce(awaiting, { type: 'Confirm' });
    assert(confirmed.applied && confirmed.nextAction === 'confirm_order', 'confirm while awaiting');
    const reply = commerce.renderCommerceReply(
      awaiting,
      confirmed.state,
      confirmed,
      'arabic',
      { type: 'Confirm' },
    );
    assert(Boolean(reply.replyText), 'confirm has template');
    assert(shouldAppendOrderData('confirm_order', reply.replyText || ''), 'ORDER_DATA allowed');
  }

  {
    const before = withWatchInCart();
    const event = commerce.classifyCommerceEvent({
      messageText: 'بدي ضيف القميص',
      cart: before,
      mentionedProducts: [shirt],
      focusProduct: watch,
      wantsAddAnother: true,
    });
    assert(event.type === 'AddOrFocusProduct', `expected AddOrFocusProduct, got ${event.type}`);
    const focused = commerce.reduceCommerce(before, event);
    assert(focused.state.lines.length === 1, 'shirt is not added without a required variant');
    assert(focused.state.focusProductId === shirt.id, 'focus moves to shirt');
    const ask = commerce.renderCommerceReply(before, focused.state, focused, 'arabic', event);
    assert(!commerce.replyClaimsCartAdd(ask.replyText || ''), 'variant question does not claim add');

    const colored = commerce.reduceCommerce(focused.state, {
      type: 'SetVariant',
      productId: shirt.id,
      color: 'أحمر',
      product: shirt,
    });
    assert(colored.state.lines.length === 2, 'color selection creates the second line');
  }

  {
    const event = commerce.classifyCommerceEvent({
      messageText: 'لا بدياها لون أحمر',
      cart: { ...withWatchInCart(), phase: 'configuring' },
      mentionedProducts: [watch],
      focusProduct: watch,
    });
    assert(event.type === 'SetVariant', `variant correction expected, got ${event.type}`);
    const changed = commerce.reduceCommerce(
      { ...withWatchInCart(), phase: 'configuring' },
      event,
    );
    assert(
      normalizeArabic(changed.state.lines[0]?.color || '') === normalizeArabic('أحمر'),
      'watch becomes red',
    );
    assert(changed.state.phase !== 'cancelled', 'variant correction does not cancel');
  }

  {
    const event = commerce.classifyCommerceEvent({
      messageText: 'طيب بدي أطلب الساعة',
      cart: withWatchInCart(),
      mentionedProducts: [watch],
      botAskedConfirm: true,
    });
    assert(event.type !== 'Confirm', `new product order intent must not confirm, got ${event.type}`);
  }
}

console.log(`Commerce engine contracts: ${passed}/${passed + failed} passed`);
if (failures.length > 0) {
  for (const item of failures) console.error(`FAIL: ${item}`);
  console.log(
    'KNOWN_PENDING: commerceEngine.ts and priced cart-summary behavior are absent from the current source snapshot',
  );
  process.exit(1);
}
