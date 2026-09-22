/**
 * T1 — a bare color answers the bot's color question; it is not a photo ask.
 * Missing pending-question/commerce modules are reported as known-pending while
 * the fixture, intent, color-policy, and pipeline portions still execute.
 */
import type {
  CartItem,
  ConversationState,
  MerchantConfig,
  Product,
} from '../../core/types.js';
import type { SalesGPTPipelineResult } from './index.js';
import { processWithSalesGPT } from './index.js';
import { customerAffirmsOrder } from './orderConfirmationPolicy.js';
import { buildAskColorMessage, extractColorFromUserText } from './orderColorPolicy.js';
import { isExplicitPhotoRequest, resolveTurnIntent } from './turnIntent.js';
import {
  REAL_TEST_CATALOG,
  REAL_TEST_WATCH,
} from './realTestCatalog.js';
import {
  resetHarness,
  setCatalog,
  setLlmReply,
} from './test_pipeline_harness_state.js';

type PendingKind = 'color' | 'size' | null;
type PendingApi = {
  detectPendingBotQuestion: (reply: string) => PendingKind;
  extractBareColorAnswer: (message: string, colors: string[]) => string | null;
  isAnsweringPendingVariant: (input: {
    pending: Exclude<PendingKind, null>;
    userMessage: string;
    catalogColors: string[];
  }) => boolean;
  lastAssistantContent: (messages: { role: string; content: string }[]) => string;
  resolveIncomingPendingBotQuestion: (input: {
    stored?: PendingKind;
    lastBotReply: string;
  }) => PendingKind;
};
type CommerceApi = {
  classifyCommerceEvent: (input: {
    messageText: string;
    cart: {
      lines: CartItem[];
      identity: Record<string, string>;
      phase: string;
      focusProductId: string;
    };
    mentionedProducts: Product[];
    focusProduct: Product;
    wantsPhoto: boolean;
    pendingBotQuestion: string;
  }) => { type: string; color?: string };
};
type PendingConversationState = ConversationState & {
  pending_bot_question?: string;
  pending_bot_question_product_id?: string;
  offered_handoff?: boolean;
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
    merchantId: '00000000-0000-4000-8000-000000000201',
    storeName: 'متجر تجريبي',
    storeCurrency: 'SAR',
    persona: 'friendly',
    botLanguage: 'arabic',
  };
}

function watchCartState(overrides: Partial<PendingConversationState> = {}): PendingConversationState {
  return {
    message_count: 3,
    salesgpt_stage_id: '7',
    current_stage: 'close',
    extracted_entities: {
      product_query: REAL_TEST_WATCH.name,
      product_id: REAL_TEST_WATCH.id,
    },
    last_recommended_products: [REAL_TEST_WATCH.id],
    pending_bot_question: 'color',
    cart: {
      items: [{
        productId: REAL_TEST_WATCH.id,
        productName: REAL_TEST_WATCH.name,
        quantity: 1,
        unitPrice: 200,
        currency: 'SAR',
        addedAt: '2026-09-20T00:00:00.000Z',
      }],
      status: 'building',
      updatedAt: '2026-09-20T00:00:00.000Z',
    },
    ...overrides,
  };
}

const COLOR_ASK = buildAskColorMessage('arabic', REAL_TEST_WATCH.colors || []);
const PHOTO_THEN_COLOR = 'رح أرسلك صورة المنتج. أي لون بتحب؟ 🎨\n1) أسود — 2) أحمر';

async function runTurn(input: {
  message: string;
  state: PendingConversationState;
  llmText: string;
  nextAction?: string;
  wantsPhoto?: boolean;
  recentMessages?: { role: 'user' | 'assistant'; content: string }[];
}): Promise<SalesGPTPipelineResult> {
  resetHarness();
  setCatalog(REAL_TEST_CATALOG);
  setLlmReply({
    response_text: input.llmText,
    next_action: input.nextAction || 'send_image',
    customer_request: {
      wants_alternatives: false,
      asks_product_info: false,
      wants_photo: input.wantsPhoto !== false,
      ready_to_confirm: false,
      wants_add_another: false,
    },
    extracted_info: {},
  });
  return processWithSalesGPT({
    merchantId: merchantConfig().merchantId,
    messageText: input.message,
    recentMessages: input.recentMessages || [
      { role: 'user', content: 'بدي الساعة' },
      { role: 'assistant', content: PHOTO_THEN_COLOR },
    ],
    conversationState: input.state,
    merchantConfig: merchantConfig(),
    platform: 'playground',
  });
}

let pending: PendingApi | null = null;
let commerce: CommerceApi | null = null;
try {
  const modulePath = './pendingBotQuestion.js';
  pending = await import(modulePath) as unknown as PendingApi;
} catch (error: unknown) {
  assert(false, `pendingBotQuestion module unavailable: ${error instanceof Error ? error.message : String(error)}`);
}
try {
  const modulePath = './commerceEngine.js';
  commerce = await import(modulePath) as unknown as CommerceApi;
} catch {
  // commerceEngine SetVariant classification is a later slice; pipeline T1 below is the gate.
  commerce = null;
}

const watchColors = REAL_TEST_WATCH.colors || [];
assert(REAL_TEST_WATCH.price === 200 && REAL_TEST_WATCH.stock === 15, 'watch fixture SAR 200 stock 15');
assert(JSON.stringify(watchColors) === JSON.stringify(['أسود', 'أحمر']), 'watch colors أسود, أحمر');
assert(REAL_TEST_CATALOG.length === 3, 'real test catalog has watch/shirt/mobile');
assert(extractColorFromUserText('بدي الأسود', watchColors) === 'أسود', 'بدي الأسود maps to catalog أسود');
assert(!isExplicitPhotoRequest('الأسود'), 'bare color is not an explicit photo request');
assert(!customerAffirmsOrder('أسود'), 'bare color is not order confirmation');

if (pending) {
  assert(pending.detectPendingBotQuestion(COLOR_ASK) === 'color', 'ask-color template means pending color');
  assert(pending.detectPendingBotQuestion(PHOTO_THEN_COLOR) === 'color', 'photo+color bubble remains pending color');
  assert(
    pending.detectPendingBotQuestion('تحب نضيف شي تاني، ولا نكمّل الطلب؟') === null,
    'add-more is not pending color',
  );
  assert(
    pending.resolveIncomingPendingBotQuestion({
      stored: 'color',
      lastBotReply: 'تحب نضيف شي تاني، ولا نكمّل الطلب؟',
    }) === null,
    'a later add-more question invalidates stale stored color',
  );
  assert(
    pending.lastAssistantContent([{ role: 'assistant', content: PHOTO_THEN_COLOR }]) === PHOTO_THEN_COLOR,
    'last assistant helper',
  );

  for (const text of ['الأسود', 'أسود', 'بدي الأسود', 'الأحمر لو سمحت']) {
    assert(!isExplicitPhotoRequest(text), `bare color is not photo request: ${text}`);
    assert(pending.extractBareColorAnswer(text, watchColors) !== null, `extracts catalog color: ${text}`);
    assert(
      pending.isAnsweringPendingVariant({
        pending: 'color',
        userMessage: text,
        catalogColors: watchColors,
      }),
      `answers pending color: ${text}`,
    );
  }
  for (const text of ['ورجيني الأسود', 'صورة الأحمر', 'شكله كيف بالأسود', 'الأسود موجود؟']) {
    assert(
      !pending.isAnsweringPendingVariant({
        pending: 'color',
        userMessage: text,
        catalogColors: watchColors,
      }),
      `photo/availability wording is not a bare answer: ${text}`,
    );
  }
}

if (commerce) {
  const event = commerce.classifyCommerceEvent({
    messageText: 'الأسود',
    cart: {
      lines: watchCartState().cart?.items || [],
      identity: {},
      phase: 'configuring',
      focusProductId: REAL_TEST_WATCH.id,
    },
    mentionedProducts: [],
    focusProduct: REAL_TEST_WATCH,
    wantsPhoto: true,
    pendingBotQuestion: 'color',
  });
  assert(event.type === 'SetVariant', `pending color beats RequestPhoto, got ${event.type}`);
  assert(event.color === 'أسود', `SetVariant color is أسود, got ${event.color}`);
}

const ordinary = resolveTurnIntent({
  userMessage: 'أسود',
  customerRequest: {
    wantsAlternatives: false,
    asksProductInfo: false,
    wantsPhoto: false,
    readyToConfirm: false,
    wantsAddAnother: false,
  },
  variantAfterPhotoOffer: false,
});
assert(ordinary === 'other', `bare color without pending context stays other, got ${ordinary}`);

for (const selection of ['أسود', 'الأسود', 'بدي الأسود', 'الأحمر لو سمحت']) {
  const result = await runTurn({
    message: selection,
    state: watchCartState(),
    llmText: `تمام، رح أرسلك صورة ${selection}.`,
    nextAction: 'send_image',
    wantsPhoto: true,
  });
  const expected = /أحمر/.test(selection) ? 'أحمر' : 'أسود';
  const line = result.updatedState.cart?.items?.find((item) => item.productId === REAL_TEST_WATCH.id);
  assert(line?.color === expected, `T1 ${selection} records ${expected} on watch, got ${line?.color}`);
  assert(!/\[IMAGE:/i.test(result.replyText), `T1 ${selection} does not attach IMAGE`);
  assert(result.next_action !== 'confirm_order', `T1 ${selection} does not confirm order`);
}

// PHASE 2F: explicit photo refusal must not promise/send an image.
{
  const refusal = await runTurn({
    message: 'لا أنا ما بدي الصورة أنا بس أطلب الساعة السودا',
    state: watchCartState({
      extracted_entities: {
        product_id: REAL_TEST_WATCH.id,
        product_query: REAL_TEST_WATCH.name,
        color: 'أسود',
      },
      cart: {
        items: [
          {
            productId: REAL_TEST_WATCH.id,
            productName: REAL_TEST_WATCH.name,
            quantity: 1,
            unitPrice: 200,
            currency: 'SAR',
            color: 'أسود',
            addedAt: '2026-09-21T00:00:00.000Z',
          },
        ],
        status: 'building',
      },
    }),
    llmText: 'تمام، رح أرسلك صورة المنتج.',
    nextAction: 'send_image',
    wantsPhoto: true,
    recentMessages: [
      { role: 'assistant', content: 'أي لون بتحب؟ 🎨\n1) أسود — 2) أحمر' },
      { role: 'user', content: 'الأسود' },
      { role: 'assistant', content: 'تمام، ثبتّ اللون أسود لـ ساعة.' },
    ],
  });
  assert(!/\[IMAGE:/i.test(refusal.replyText), 'refusal does not attach IMAGE');
  assert(
    !/رح أرسلك صورة|سأرسل(?:ك| لك)?\s*صورة/i.test(refusal.replyText),
    `refusal must not promise a photo, got: ${refusal.replyText}`,
  );
  assert(refusal.next_action !== 'send_image', `refusal next_action not send_image, got ${refusal.next_action}`);
}

console.log(`pending_bot_question T1: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  for (const item of failures) console.error(`FAIL: ${item}`);
  process.exit(1);
}
process.exit(0);
