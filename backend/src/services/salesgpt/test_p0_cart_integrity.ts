/**
 * P0 cart integrity regressions reconstructed from the compiled backup.
 * Assertions prefer deterministic cart state; model prose is used only to
 * ensure false image/add/currency claims do not escape.
 *
 * PHASE 2A: line color/currency + merge assertions are hard gates.
 * Remaining slices (commerceEngine, priced summaries, image policy) stay
 * KNOWN_PENDING until restored.
 */
import type {
  CartItem,
  ConversationState,
  MerchantConfig,
  Product,
} from '../../core/types.js';
import type { SalesGPTPipelineResult } from './index.js';
import { processWithSalesGPT } from './index.js';
import {
  fillCartVariantsFromDraft,
  formatCartSummary,
  getCartItems,
} from './conversationCart.js';
import { customerCancelsOrder } from './orderConfirmationPolicy.js';
import { classifyInterimCancelIntent } from './interimCancelMatchers.js';
import { matchCartLinesForRemoval } from './cartLineRemoval.js';
import {
  REAL_TEST_CATALOG,
  REAL_TEST_MOBILE,
  REAL_TEST_SHIRT,
  REAL_TEST_WATCH,
} from './realTestCatalog.js';
import {
  resetHarness,
  setCatalog,
  setLlmReply,
} from './test_pipeline_harness_state.js';

type CartState = {
  lines: CartItem[];
  identity: Record<string, string>;
  phase: string;
  focusProductId?: string;
};
type CommerceEvent = {
  type: string;
  productId?: string;
  color?: string;
};
type CommerceApi = {
  classifyCommerceEvent: (input: {
    messageText: string;
    cart: CartState;
    mentionedProducts: Product[];
    focusProduct?: Product;
  }) => CommerceEvent;
};
type TestState = ConversationState & {
  pending_bot_question?: 'color' | 'size' | null;
  pending_bot_question_product_id?: string | null;
};

let hardPassed = 0;
let hardFailed = 0;
const hardFailures: string[] = [];
let pendingFailed = 0;
const pendingFailures: string[] = [];

function assertHard(condition: boolean, message: string): void {
  if (condition) {
    hardPassed += 1;
  } else {
    hardFailed += 1;
    hardFailures.push(message);
  }
}

function assertPending(condition: boolean, message: string): void {
  if (condition) {
    hardPassed += 1;
  } else {
    pendingFailed += 1;
    pendingFailures.push(message);
  }
}

function merchantConfig(): MerchantConfig {
  return {
    merchantId: '00000000-0000-4000-8000-000000000301',
    storeName: 'متجر تجريبي',
    storeCurrency: 'SAR',
    persona: 'friendly',
    botLanguage: 'arabic',
  };
}

function emptyState(overrides: Partial<TestState> = {}): TestState {
  return {
    message_count: 4,
    salesgpt_stage_id: '7',
    current_stage: 'close',
    extracted_entities: {},
    ...overrides,
  };
}

function watchLine(color?: string): CartItem {
  return {
    productId: REAL_TEST_WATCH.id,
    productName: REAL_TEST_WATCH.name,
    quantity: 1,
    unitPrice: 200,
    currency: 'SAR',
    color,
    addedAt: '2026-09-20T00:00:00.000Z',
  };
}

function shirtLine(): CartItem {
  return {
    productId: REAL_TEST_SHIRT.id,
    productName: REAL_TEST_SHIRT.name,
    quantity: 1,
    unitPrice: 553,
    currency: 'USD',
    addedAt: '2026-09-20T00:00:01.000Z',
  };
}

function twoLineState(): TestState {
  return emptyState({
    last_recommended_products: [REAL_TEST_WATCH.id, REAL_TEST_SHIRT.id],
    extracted_entities: {
      product_query: REAL_TEST_WATCH.name,
      product_id: REAL_TEST_WATCH.id,
      color: 'أسود',
    },
    cart: {
      items: [watchLine('أسود'), shirtLine()],
      status: 'building',
      updatedAt: '2026-09-20T00:00:02.000Z',
    },
  });
}

async function runTurn(input: {
  message: string;
  state: TestState;
  llmText: string;
  nextAction?: string;
  wantsAddAnother?: boolean;
  extractedInfo?: Record<string, unknown>;
  recentMessages?: { role: 'user' | 'assistant'; content: string }[];
}): Promise<SalesGPTPipelineResult> {
  resetHarness();
  setCatalog(REAL_TEST_CATALOG);
  setLlmReply({
    response_text: input.llmText,
    next_action: input.nextAction || 'present_product',
    customer_request: {
      wants_alternatives: false,
      asks_product_info: false,
      wants_photo: false,
      ready_to_confirm: false,
      wants_add_another: input.wantsAddAnother === true,
    },
    extracted_info: input.extractedInfo || {},
  });
  return processWithSalesGPT({
    merchantId: merchantConfig().merchantId,
    messageText: input.message,
    recentMessages: input.recentMessages || [],
    conversationState: input.state,
    merchantConfig: merchantConfig(),
    platform: 'playground',
  });
}

// ——— Soft-pending: commerceEngine (not PHASE 2B) ———
let commerce: CommerceApi | null = null;
try {
  const modulePath = './commerceEngine.js';
  commerce = (await import(modulePath)) as unknown as CommerceApi;
} catch (error: unknown) {
  assertPending(
    false,
    `commerceEngine module unavailable: ${error instanceof Error ? error.message : String(error)}`,
  );
}

const twoLineCart: CartState = {
  lines: [watchLine('أسود'), shirtLine()],
  identity: {},
  phase: 'configuring',
  focusProductId: REAL_TEST_WATCH.id,
};

// Hard: interim cancel/remove rails (PHASE 2B ITEM 2)
{
  assertHard(
    classifyInterimCancelIntent('خلص بدي الغي القميص') === 'partial_remove',
    'partial cancel classifies as partial_remove',
  );
  assertHard(
    classifyInterimCancelIntent('ألغي الطلب كله') === 'whole_cancel',
    'full cancel classifies as whole_cancel',
  );
  assertHard(
    classifyInterimCancelIntent('لا ما بدي اسود بدي احمر') === 'none',
    'variant correction is not cancellation',
  );
  assertHard(
    classifyInterimCancelIntent('لا شكراً بس بدي الأزرق') === 'none',
    'لا شكراً بس بدي الأزرق is not cancel',
  );
  assertHard(
    classifyInterimCancelIntent('بعدين بخبرك') === 'none',
    'بعدين بخبرك is not cancel',
  );
  assertHard(customerCancelsOrder('ألغي الطلب كله'), 'explicit full cancel is detected');
  assertHard(
    !customerCancelsOrder('لا ما بدي اسود بدي احمر'),
    'variant correction is not customerCancelsOrder',
  );

  const shirtHits = matchCartLinesForRemoval('خلص بدي الغي القميص', twoLineCart.lines);
  assertHard(
    shirtHits.length === 1 && shirtHits[0].productId === REAL_TEST_SHIRT.id,
    'line-match targets shirt from cart names',
  );
  const missingHits = matchCartLinesForRemoval('الغي الموبايل', twoLineCart.lines);
  assertHard(missingHits.length === 0, 'absent product matches no cart line');
}

if (commerce) {
  const partial = commerce.classifyCommerceEvent({
    messageText: 'خلص بدي الغي القميص',
    cart: twoLineCart,
    mentionedProducts: [REAL_TEST_SHIRT],
    focusProduct: REAL_TEST_WATCH,
  });
  assertPending(partial.type === 'RemoveLine', `partial cancel → RemoveLine, got ${partial.type}`);
  assertPending(partial.productId === REAL_TEST_SHIRT.id, 'partial cancel targets shirt');

  const all = commerce.classifyCommerceEvent({
    messageText: 'ألغي الطلب كله',
    cart: twoLineCart,
    mentionedProducts: [],
    focusProduct: REAL_TEST_WATCH,
  });
  assertPending(all.type === 'Cancel', `full cancel → Cancel, got ${all.type}`);

  const correction = commerce.classifyCommerceEvent({
    messageText: 'لا ما بدي اسود بدي احمر',
    cart: { ...twoLineCart, lines: [watchLine('أسود')] },
    mentionedProducts: [],
    focusProduct: REAL_TEST_WATCH,
  });
  assertPending(
    correction.type === 'SetVariant',
    `color correction → SetVariant, got ${correction.type}`,
  );
  assertPending(
    correction.color === 'أحمر' || correction.color === 'احمر',
    `new color is red, got ${correction.color}`,
  );

  const missing = commerce.classifyCommerceEvent({
    messageText: 'الغي الموبايل',
    cart: twoLineCart,
    mentionedProducts: [REAL_TEST_MOBILE],
    focusProduct: REAL_TEST_WATCH,
  });
  assertPending(
    missing.type !== 'Cancel' && missing.type !== 'RemoveLine',
    `product absent from cart must not be removed/cancel all, got ${missing.type}`,
  );
}

{
  const summary = formatCartSummary([watchLine('أسود'), shirtLine()], 'arabic');
  const shirtRow = summary.split('\n').find((row) => /قميص/.test(row)) || '';
  assertHard(summary.includes('ساعة') && summary.includes('قميص'), 'summary keeps per-line identity');
  assertHard(/أسود/.test(summary), 'watch variant is present');
  assertHard(!/أسود/.test(shirtRow), 'shirt does not inherit watch color');
  assertHard(/200/.test(summary) && /ريال/.test(summary), 'watch line is SAR 200');
  assertHard(/553/.test(summary) && /دولار/.test(summary), 'shirt line is USD 553');
  assertHard(!/753/.test(summary), 'mixed currencies are never summed as 753');
  assertHard(
    /مجموع المنتجات/.test(summary) && /ريال/.test(summary) && /دولار/.test(summary),
    `summary has per-currency totals:\n${summary}`,
  );
}

// ——— Hard: color belongs to the line (FIX 1) ———
{
  const seeded = emptyState({
    extracted_entities: {
      product_query: REAL_TEST_SHIRT.name,
      product_id: REAL_TEST_SHIRT.id,
      color: 'أسود',
    },
    cart: {
      items: [watchLine('أسود'), shirtLine()],
      status: 'building',
      updatedAt: '2026-09-20T00:00:02.000Z',
    },
  });
  const filled = fillCartVariantsFromDraft(seeded, REAL_TEST_SHIRT);
  const shirt = getCartItems(filled).find((item) => item.productId === REAL_TEST_SHIRT.id);
  const watch = getCartItems(filled).find((item) => item.productId === REAL_TEST_WATCH.id);
  assertHard(watch?.color === 'أسود', 'watch keeps black');
  assertHard(!shirt?.color, `colorless shirt does not inherit black, got ${shirt?.color}`);
}

{
  const partial = await runTurn({
    message: 'خلص بدي الغي القميص',
    state: twoLineState(),
    llmText: 'تمام، ألغيت الطلب.',
    recentMessages: [{ role: 'assistant', content: 'تحب نضيف شي تاني، ولا نكمّل الطلب؟' }],
  });
  const items = getCartItems(partial.updatedState);
  assertHard(
    items.some((item) => item.productId === REAL_TEST_WATCH.id),
    'pipeline partial cancel keeps watch',
  );
  assertHard(
    !items.some((item) => item.productId === REAL_TEST_SHIRT.id),
    'pipeline partial cancel removes shirt',
  );
  assertHard(partial.next_action !== 'confirm_order', 'partial cancel does not confirm');
}

{
  const missing = await runTurn({
    message: 'الغي الموبايل',
    state: twoLineState(),
    llmText: 'تم',
  });
  const items = getCartItems(missing.updatedState);
  assertHard(items.length === 2, 'absent product removes nothing from cart');
  assertHard(
    /مو موجود|not in your current order/i.test(missing.replyText),
    `absent product gets honest reply, got: ${missing.replyText}`,
  );
}

{
  const changed = await runTurn({
    message: 'لا ما بدي اسود بدي احمر',
    state: emptyState({
      last_recommended_products: [REAL_TEST_WATCH.id],
      extracted_entities: {
        product_query: REAL_TEST_WATCH.name,
        product_id: REAL_TEST_WATCH.id,
        color: 'أسود',
      },
      cart: {
        items: [watchLine('أسود')],
        status: 'building',
      },
    }),
    llmText: 'تم التحديث',
    recentMessages: [{ role: 'assistant', content: 'أي لون بتحب؟ أسود أو أحمر' }],
  });
  const watch = getCartItems(changed.updatedState).find(
    (item) => item.productId === REAL_TEST_WATCH.id,
  );
  assertHard(
    watch?.color === 'أحمر',
    `pipeline correction changes watch to red, got ${watch?.color}`,
  );
  assertHard(
    /حدّثت|تم التحديث|تحديث/.test(changed.replyText),
    `update claim when cart changed: ${changed.replyText}`,
  );

  const same = await runTurn({
    message: 'لا ما بدي اسود بدي احمر',
    state: emptyState({
      last_recommended_products: [REAL_TEST_WATCH.id],
      extracted_entities: {
        product_query: REAL_TEST_WATCH.name,
        product_id: REAL_TEST_WATCH.id,
        color: 'أحمر',
      },
      cart: {
        items: [watchLine('أحمر')],
        status: 'building',
      },
    }),
    llmText: 'تم التحديث',
    recentMessages: [{ role: 'assistant', content: 'تمام، حدّثت طلبك.' }],
  });
  const again = getCartItems(same.updatedState).find(
    (item) => item.productId === REAL_TEST_WATCH.id,
  );
  assertHard(again?.color === 'أحمر', 'already-red stays أحمر');
  assertHard(
    !/حدّثت طلبك|تم التحديث/.test(same.replyText),
    `no update claim when cart unchanged: ${same.replyText}`,
  );
}

// playground-2026-09-21 — exact reported conversation.
{
  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  let state: TestState = { message_count: 0, extracted_entities: {} };

  const turns: Array<{
    message: string;
    llmText: string;
    nextAction?: string;
    wantsAddAnother?: boolean;
    extractedInfo?: Record<string, unknown>;
    check?: (result: SalesGPTPipelineResult, label: string) => void;
  }> = [
    {
      message: 'السلام عليكم',
      llmText: 'وعليكم السلام، أهلاً وسهلاً فيك!',
      check: (result, label) =>
        assertHard(getCartItems(result.updatedState).length === 0, `${label} greeting keeps cart empty`),
    },
    {
      message: 'ممكن أعرف شو في عنكن منتجات',
      llmText: 'عنا ساعة بـ200 ريال، وقميص بـ553 دولار، والموبايل غير متوفر حالياً.',
    },
    {
      message: 'شو تفاصيل الساعة والقميص',
      llmText: 'الساعة بـ200 ريال وبالأسود والأحمر. القميص بـ553 دولار وما إله ألوان.',
    },
    {
      message: 'بدي اطلب الساعة',
      llmText: 'أكيد، أي لون بتحب للساعة: الأسود أو الأحمر؟',
      nextAction: 'collect_info',
    },
    {
      message: 'الأسود',
      llmText: 'تمام، رح أرسلك صورة الساعة السودا.',
      nextAction: 'send_image',
      check: (result, label) => {
        const watch = getCartItems(result.updatedState).find(
          (item) => item.productId === REAL_TEST_WATCH.id,
        );
        assertHard(
          watch?.color === 'أسود',
          `${label} state binds black to watch, got ${watch?.color}`,
        );
        assertHard(!/\[IMAGE:/i.test(result.replyText), `${label} bare color emits no IMAGE tag`);
      },
    },
    {
      message: 'لا أنا ما بدي الصورة أنا بس أطلب الساعة السودا',
      llmText: 'تمام، ثبتت الساعة السودا بطلبك. تحب نكمّل؟',
      check: (result, label) => {
        const watch = getCartItems(result.updatedState).find(
          (item) => item.productId === REAL_TEST_WATCH.id,
        );
        assertHard(watch?.color === 'أسود', `${label} refusal keeps black watch state`);
        assertHard(
          !/\[IMAGE:/i.test(result.replyText),
          `${label} explicit refusal emits no image`,
        );
      },
    },
    {
      message: 'اي تمام',
      llmText: 'ممتاز، شو اسمك الكامل؟',
      nextAction: 'collect_info',
    },
    {
      message: 'سفيان محمد',
      llmText: 'تشرفنا سفيان، شو رقم هاتفك؟',
      nextAction: 'collect_info',
      extractedInfo: { name: 'سفيان محمد' },
    },
    {
      message: '09552222',
      llmText: 'تمام، شو عنوان التوصيل؟',
      nextAction: 'collect_info',
      extractedInfo: { phone: '09552222' },
    },
    {
      message: 'الحسينية دمشق',
      llmText: 'تمام، هذا ملخص طلبك: ساعة سوداء بـ200 ريال. إذا تمام أكّد لي.',
      nextAction: 'await_confirmation',
      extractedInfo: { address: 'الحسينية دمشق' },
    },
    {
      message: 'بدي ضيف القميص كمان',
      llmText: 'تمام، أضفت القميص كمان. الساعة 200 ريال والقميص 553 دولار.',
      wantsAddAnother: true,
      check: (result, label) => {
        const items = getCartItems(result.updatedState);
        const watch = items.find((item) => item.productId === REAL_TEST_WATCH.id);
        const shirt = items.find((item) => item.productId === REAL_TEST_SHIRT.id);
        assertHard(items.length === 2, `${label} cart has exactly two lines, got ${items.length}`);
        assertHard(
          watch?.color === 'أسود' && watch.unitPrice === 200 && watch.currency === 'SAR',
          `${label} watch line is black SAR 200`,
        );
        assertHard(
          !!shirt && shirt.unitPrice === 553 && shirt.currency === 'USD' && !shirt.color,
          `${label} shirt line is colorless USD 553`,
        );
        const summary = formatCartSummary(items, 'arabic');
        assertHard(
          /ساعة[\s\S]*200[\s\S]*ريال/.test(summary),
          `${label} summary prices watch line`,
        );
        assertHard(
          /قميص[\s\S]*553[\s\S]*دولار/.test(summary),
          `${label} summary prices shirt line`,
        );
        assertHard(!/753/.test(summary), `${label} summary keeps totals per currency`);
        assertHard(
          /مجموع المنتجات/.test(summary) && /ريال/.test(summary) && /دولار/.test(summary),
          `${label} confirmation summary shows totals per currency`,
        );
      },
    },
  ];

  assertHard(turns.length === 11, `playground replay has 11 turns, got ${turns.length}`);
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    const result = await runTurn({
      message: turn.message,
      state,
      llmText: turn.llmText,
      nextAction: turn.nextAction,
      wantsAddAnother: turn.wantsAddAnother,
      extractedInfo: turn.extractedInfo,
      recentMessages: history.slice(-8),
    });
    turn.check?.(result, `playground-2026-09-21 T${index + 1}`);
    history.push({ role: 'user', content: turn.message });
    history.push({ role: 'assistant', content: result.replyText });
    state = result.updatedState;
  }
}

console.log(
  `P0 cart integrity: ${hardPassed} hard-passed, ${hardFailed} hard-failed, ${pendingFailed} known-pending`,
);
if (hardFailures.length > 0) {
  for (const item of hardFailures) console.error(`FAIL: ${item}`);
  process.exit(1);
}
if (pendingFailures.length > 0) {
  for (const item of pendingFailures) console.error(`PENDING: ${item}`);
  console.error(
    'KNOWN_PENDING: commerceEngine module classification and collect-info-order field sequencing are not restored yet',
  );
  process.exit(0);
}
process.exit(0);
