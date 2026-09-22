/**
 * P0 color focus: a bare color binds to the product being discussed, never to
 * a stale out-of-stock mobile whose "colors" are actually brand names.
 */
import type {
  ConversationState,
  MerchantConfig,
  Product,
} from '../../core/types.js';
import type { SalesGPTPipelineResult } from './index.js';
import { processWithSalesGPT } from './index.js';
import { getCartItems } from './conversationCart.js';
import {
  REAL_TEST_CATALOG,
  REAL_TEST_MOBILE,
  REAL_TEST_SHIRT,
  REAL_TEST_WATCH,
} from './realTestCatalog.js';
import { LIVE_TEN_PRODUCT_CATALOG } from './liveEval/liveCatalog.js';
import {
  resetHarness,
  setCatalog,
  setLlmReply,
} from './test_pipeline_harness_state.js';

type GroundingResult = { valid: boolean; reasons: string[] };
type GroundingApi = {
  validateCatalogReplyGrounding: (input: {
    responseText: string;
    products: Product[];
    customerMessage?: string;
  }) => GroundingResult;
};
type FocusState = ConversationState & {
  pending_bot_question?: 'color' | 'size' | null;
  pending_bot_question_product_id?: string | null;
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

function merchantConfig(): MerchantConfig {
  return {
    merchantId: '00000000-0000-4000-8000-000000000401',
    storeName: 'متجر تجريبي',
    storeCurrency: 'SAR',
    persona: 'friendly',
    botLanguage: 'arabic',
  };
}

function emptyState(overrides: Partial<FocusState> = {}): FocusState {
  return { message_count: 1, extracted_entities: {}, ...overrides };
}

const MOBILE_BRAND_LEAK = /Samsung|Apple|Xiaomi|سامسونج|ايفون|آيفون|شاومي/i;
const LIVE_WATCH_DETAILS = 'الساعة سعرها 200 ريال، متوفرة بالأسود والأحمر. أي لون بتحب؟';
const LIVE_WRONG_MOBILE_COLORS = 'هذا اللون غير متوفر… الألوان المتاحة: سامسونج — ايفون';
const LIVE_FALSE_WATCH_APOLOGY = 'الأسود غير متوفر، المتاح الأحمر';
const LIVE_MOBILE_UNAVAILABLE = 'الموبايل غير متوفر حالياً.';
const LIVE_SHIRT_DETAILS = 'القميص سعره 553 دولار، وما إله ألوان.';

function watchColor(state: ConversationState): string | undefined {
  return getCartItems(state).find((item) => item.productId === REAL_TEST_WATCH.id)?.color;
}

function hasMobileLine(state: ConversationState): boolean {
  return getCartItems(state).some((item) => item.productId === REAL_TEST_MOBILE.id);
}

async function runTurn(input: {
  message: string;
  state: FocusState;
  llmText: string;
  asksProductInfo?: boolean;
  recentMessages?: { role: 'user' | 'assistant'; content: string }[];
}): Promise<SalesGPTPipelineResult> {
  resetHarness();
  setCatalog(REAL_TEST_CATALOG);
  setLlmReply({
    response_text: input.llmText,
    next_action: 'present_product',
    customer_request: {
      wants_alternatives: false,
      asks_product_info: input.asksProductInfo === true,
      wants_photo: false,
      ready_to_confirm: false,
      wants_add_another: false,
    },
    extracted_info: {},
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

assert(REAL_TEST_WATCH.price === 200 && REAL_TEST_WATCH.stock === 15, 'watch SAR 200 stock 15');
assert(JSON.stringify(REAL_TEST_WATCH.colors) === JSON.stringify(['أسود', 'أحمر']), 'watch colors exact');
assert(REAL_TEST_SHIRT.price === 553 && (REAL_TEST_SHIRT.colors || []).length === 0, 'shirt USD 553 no colors');
assert(REAL_TEST_MOBILE.stock === 0 && REAL_TEST_MOBILE.price === 1000, 'mobile SAR 1000 stock 0');
assert((REAL_TEST_MOBILE.colors || []).length > 0, 'mobile color field contains brand names');

let grounding: GroundingApi | null = null;
try {
  const modulePath = './catalogGrounding.js';
  const loaded = await import(modulePath) as unknown as Partial<GroundingApi>;
  grounding = typeof loaded.validateCatalogReplyGrounding === 'function'
    ? loaded as GroundingApi
    : null;
  if (!grounding) assert(false, 'validateCatalogReplyGrounding export unavailable');
} catch (error: unknown) {
  assert(false, `catalog grounding validator unavailable: ${error instanceof Error ? error.message : String(error)}`);
}

if (grounding) {
  const apology = grounding.validateCatalogReplyGrounding({
    responseText: LIVE_FALSE_WATCH_APOLOGY,
    products: [REAL_TEST_WATCH],
    customerMessage: 'احنا عمنحكي عن الساعة',
  });
  assert(!apology.valid, 'false black-unavailable claim fails grounding');
  assert(
    apology.reasons.includes('ungrounded_color') ||
      apology.reasons.includes('false_color_availability'),
    `negative availability has a grounding reason: ${apology.reasons.join(',')}`,
  );
  const mobileMismatch = grounding.validateCatalogReplyGrounding({
    responseText: LIVE_FALSE_WATCH_APOLOGY,
    products: [REAL_TEST_MOBILE],
    customerMessage: 'احنا عمنحكي عن الساعة',
  });
  assert(!mobileMismatch.valid, 'watch-color apology does not ground against mobile');
}

// Exact playground focus sequence.
{
  let state: FocusState = emptyState();
  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  const messages = [
    { message: 'شوفي عندك منتجات', llmText: 'عندنا ساعة وقميص وموبايل. شو بتحب؟' },
    { message: 'في موبايلات', llmText: LIVE_MOBILE_UNAVAILABLE },
    { message: 'شو تفاصيل الساعة', llmText: LIVE_WATCH_DETAILS, asksProductInfo: true },
    { message: 'الأسود', llmText: LIVE_WRONG_MOBILE_COLORS },
    { message: 'احنا عمنحكي عن الساعة', llmText: LIVE_FALSE_WATCH_APOLOGY },
    { message: 'بدي الأحمر', llmText: LIVE_WRONG_MOBILE_COLORS },
  ] as const;

  for (let index = 0; index < messages.length; index += 1) {
    const turn = messages[index];
    const result = await runTurn({
      ...turn,
      state,
      recentMessages: history.slice(-8),
    });
    if (index === 0) {
      assert(
        result.next_action !== 'collect_info',
        `C1 browse catalog must not force collect_info, got ${result.next_action}`,
      );
      assert(
        result.intent === 'product_query' ||
          result.intent === 'browse' ||
          result.intent === 'other',
        `C1 browse intent not order-collect, got ${result.intent}`,
      );
    }
    if (index === 1) {
      assert(/غير متوفر|نفد|مو موجود/.test(result.replyText), 'C1 mobile is unavailable');
      assert(!hasMobileLine(result.updatedState), 'C1 OOS mobile is not a cart line');
      assert(
        result.next_action !== 'collect_info',
        `C1 OOS availability must not force collect_info, got ${result.next_action}`,
      );
    }
    if (index === 2) {
      const focused = result.updatedState as FocusState;
      assert(focused.extracted_entities?.product_id === REAL_TEST_WATCH.id, 'C1 watch is active product');
      assert(focused.pending_bot_question === 'color', 'C1 watch details leave pending color');
      assert(
        focused.pending_bot_question_product_id === REAL_TEST_WATCH.id,
        'C1 pending color is scoped to watch',
      );
      assert(!MOBILE_BRAND_LEAK.test(result.replyText), 'C1 watch details do not leak mobile brands');
      // Details already include an explicit color ask in the stub — not a silent collect hijack.
      assert(
        /200|ريال|أسود|أحمر/.test(result.replyText),
        `C1 watch details keep product facts, got: ${result.replyText}`,
      );
    }
    if (index === 3) {
      assert(watchColor(result.updatedState) === 'أسود', 'C1 الأسود binds black to watch');
      assert(!hasMobileLine(result.updatedState), 'C1 black does not create mobile line');
      assert(!MOBILE_BRAND_LEAK.test(result.replyText), 'C1 black reply has no mobile brands');
    }
    if (index === 4) {
      assert(watchColor(result.updatedState) === 'أسود', 'C1 dispute preserves black watch');
      assert(!MOBILE_BRAND_LEAK.test(result.replyText), 'C1 dispute has no mobile brand leak');
    }
    if (index === 5) {
      assert(watchColor(result.updatedState) === 'أحمر', 'C1 red updates the watch');
      assert(!hasMobileLine(result.updatedState), 'C1 red does not create mobile line');
      assert(!MOBILE_BRAND_LEAK.test(result.replyText), 'C1 red reply has no mobile brands');
    }
    history.push({ role: 'user', content: turn.message });
    history.push({ role: 'assistant', content: result.replyText });
    state = result.updatedState;
  }
}

// Mobile → shirt details → order shirt: no color question and no inherited brand.
{
  let state: FocusState = emptyState();
  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const turn of [
    { message: 'في موبايلات', llmText: LIVE_MOBILE_UNAVAILABLE },
    { message: 'شو تفاصيل القميص', llmText: LIVE_SHIRT_DETAILS, asksProductInfo: true },
  ]) {
    const result = await runTurn({ ...turn, state, recentMessages: history });
    history.push({ role: 'user', content: turn.message });
    history.push({ role: 'assistant', content: result.replyText });
    state = result.updatedState;
  }
  const ordered = await runTurn({
    message: 'بدي القميص',
    state,
    llmText: 'تمام، القميص صار بطلبك. أي لون بتحب؟',
    recentMessages: history,
  });
  const shirt = getCartItems(ordered.updatedState).find(
    (item) => item.productId === REAL_TEST_SHIRT.id,
  );
  assert(Boolean(shirt), 'C2 shirt is added');
  assert(!shirt?.color, 'C2 shirt gets no invented color');
  assert(!/أي لون|الألوان المتاحة/i.test(ordered.replyText), 'C2 shirt does not ask for color');
  assert(!MOBILE_BRAND_LEAK.test(ordered.replyText), 'C2 shirt has no mobile brand leak');
  assert(!hasMobileLine(ordered.updatedState), 'C2 OOS mobile remains absent');
}

// Dispute text is re-checked against the discussed watch, not stale mobile data.
{
  const mobile = await runTurn({
    message: 'في موبايلات',
    state: emptyState(),
    llmText: LIVE_MOBILE_UNAVAILABLE,
  });
  const watch = await runTurn({
    message: 'شو تفاصيل الساعة',
    state: mobile.updatedState,
    llmText: LIVE_WATCH_DETAILS,
    asksProductInfo: true,
    recentMessages: [
      { role: 'user', content: 'في موبايلات' },
      { role: 'assistant', content: mobile.replyText },
    ],
  });
  const disputed = await runTurn({
    message: 'أنت قلت في أسود',
    state: watch.updatedState,
    llmText: LIVE_FALSE_WATCH_APOLOGY,
    recentMessages: [
      { role: 'user', content: 'شو تفاصيل الساعة' },
      { role: 'assistant', content: watch.replyText },
    ],
  });
  const claimsBlackUnavailable =
    /أسود[^.\n]{0,24}غير متوفر|غير متوفر[^.\n]{0,24}أسود/.test(disputed.replyText);
  assert(!claimsBlackUnavailable, `C3 must not claim watch black unavailable: ${disputed.replyText}`);
  assert(!MOBILE_BRAND_LEAK.test(disputed.replyText), 'C3 dispute has no mobile brand leak');
  assert(
    disputed.updatedState.extracted_entities?.product_id === REAL_TEST_WATCH.id ||
      getCartItems(disputed.updatedState).some((item) => item.productId === REAL_TEST_WATCH.id),
    'C3 discussed product remains the watch',
  );
}

// OOS product is never a variant target or cart line.
{
  const mobile = await runTurn({
    message: 'في موبايلات',
    state: emptyState(),
    llmText: LIVE_MOBILE_UNAVAILABLE,
  });
  const color = await runTurn({
    message: 'الأسود',
    state: mobile.updatedState,
    llmText: LIVE_WRONG_MOBILE_COLORS,
    recentMessages: [
      { role: 'user', content: 'في موبايلات' },
      { role: 'assistant', content: mobile.replyText },
    ],
  });
  assert(!hasMobileLine(color.updatedState), 'C4 color does not add OOS mobile');
  assert(
    color.updatedState.extracted_entities?.color !== 'أسود' ||
      color.updatedState.extracted_entities?.product_id !== REAL_TEST_MOBILE.id,
    'C4 color is not recorded on OOS mobile',
  );
  assert(
    !/الألوان المتاحة:/.test(color.replyText) || !MOBILE_BRAND_LEAK.test(color.replyText),
    'C4 brand names are not offered as colors',
  );
  const size = await runTurn({
    message: 'M',
    state: color.updatedState,
    llmText: 'أي مقاس بتحب للموبايل؟',
    recentMessages: [
      { role: 'user', content: 'الأسود' },
      { role: 'assistant', content: color.replyText },
    ],
  });
  assert(!hasMobileLine(size.updatedState), 'C4 size does not add OOS mobile');
  assert(
    size.updatedState.extracted_entities?.size == null ||
      size.updatedState.extracted_entities?.product_id !== REAL_TEST_MOBILE.id,
    'C4 size is not recorded on OOS mobile',
  );
}

// PHASE 2F S20: shoe then «أبيض» must use shoe colors, not watch أسود/أحمر.
{
  const shoesId = 'shoes-sar-350';
  async function runTen(input: {
    message: string;
    state: ConversationState;
    llmText: string;
    nextAction?: string;
    recentMessages?: { role: 'user' | 'assistant'; content: string }[];
  }): Promise<SalesGPTPipelineResult> {
    resetHarness();
    setCatalog(LIVE_TEN_PRODUCT_CATALOG);
    setLlmReply({
      response_text: input.llmText,
      next_action: input.nextAction || 'present_product',
      customer_request: {
        wants_alternatives: false,
        asks_product_info: false,
        wants_photo: false,
        ready_to_confirm: false,
        wants_add_another: false,
      },
      extracted_info: {},
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

  const shoeAsk = await runTen({
    message: 'بدي الحذاء الرياضي',
    state: emptyState(),
    llmText:
      'يا هلا! أنا مساعد مبيعات في متجر قياس حي. حابب أساعدك في الحصول على الحذاء الرياضي. هل تفضل لون معين؟ الأبيض أو الأسود.',
    nextAction: 'collect_info',
  });
  assert(
    shoeAsk.updatedState.extracted_entities?.product_id === shoesId ||
      shoeAsk.updatedState.last_recommended_products?.[0] === shoesId ||
      getCartItems(shoeAsk.updatedState).some((item) => item.productId === shoesId),
    `S20 focus after shoe ask is shoes, got product_id=${shoeAsk.updatedState.extracted_entities?.product_id}`,
  );

  const white = await runTen({
    message: 'أبيض',
    state: shoeAsk.updatedState,
    llmText: 'تمام، ثبتّ اللون أبيض للحذاء.',
    nextAction: 'collect_info',
    recentMessages: [
      { role: 'user', content: 'بدي الحذاء الرياضي' },
      { role: 'assistant', content: shoeAsk.replyText },
    ],
  });
  const offersWatchOnlyColors =
    /الألوان المتاحة:/.test(white.replyText) &&
    /أسود/.test(white.replyText) &&
    /أحمر/.test(white.replyText) &&
    !/أبيض|ابيض/.test(white.replyText);
  assert(
    !offersWatchOnlyColors,
    `S20 أبيض must not offer watch-only أسود/أحمر, got: ${white.replyText}`,
  );
  assert(
    !/غير متوفر لهذا المنتج/.test(white.replyText) || /أبيض|ابيض/.test(white.replyText),
    `S20 must not reject أبيض as unavailable for shoes, got: ${white.replyText}`,
  );
  assert(
    white.updatedState.extracted_entities?.product_id === shoesId ||
      getCartItems(white.updatedState).some(
        (item) => item.productId === shoesId && /أبيض|ابيض/.test(item.color || '')
      ) ||
      white.updatedState.last_recommended_products?.[0] === shoesId,
    'S20 after أبيض focus remains shoes',
  );
}

console.log(`P0 color-focus: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  for (const item of failures) console.error(`FAIL: ${item}`);
  process.exit(1);
}
process.exit(0);
