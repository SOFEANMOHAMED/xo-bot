/**
 * HOTFIX 2E — browse / price / greeting must never be rewritten into
 * collect_info color or identity templates while a product is focused.
 *
 * Run: npm run test-browse-not-collect
 */
import type { ConversationState, MerchantConfig } from '../../core/types.js';
import type { SalesGPTPipelineResult } from './index.js';
import { processWithSalesGPT } from './index.js';
import { getCartItems } from './conversationCart.js';
import {
  REAL_TEST_CATALOG,
  REAL_TEST_WATCH,
} from './realTestCatalog.js';
import {
  resetHarness,
  setCatalog,
  setLlmReply,
} from './test_pipeline_harness_state.js';

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
    merchantId: '00000000-0000-4000-8000-000000000501',
    storeName: 'متجر تجريبي',
    storeCurrency: 'SAR',
    persona: 'friendly',
    botLanguage: 'arabic',
  };
}

/** Focused watch, no cart — the live regression setup. */
function focusedWatchState(
  overrides: Partial<ConversationState> = {}
): ConversationState {
  return {
    message_count: 3,
    last_recommended_products: [REAL_TEST_WATCH.id],
    extracted_entities: {
      product_id: REAL_TEST_WATCH.id,
      product_query: REAL_TEST_WATCH.name,
    },
    ...overrides,
  };
}

async function runTurn(input: {
  message: string;
  state: ConversationState;
  llmText: string;
  nextAction?: string;
  asksProductInfo?: boolean;
  recentMessages?: { role: 'user' | 'assistant'; content: string }[];
}): Promise<SalesGPTPipelineResult> {
  resetHarness();
  setCatalog(REAL_TEST_CATALOG);
  setLlmReply({
    response_text: input.llmText,
    next_action: input.nextAction || 'present_product',
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

function isBrowseAction(result: SalesGPTPipelineResult): boolean {
  const action = result.next_action || '';
  return (
    action === 'present_product' ||
    action === 'greet' ||
    action === 'discover_needs' ||
    action === 'handle_objection' ||
    action === 'send_image'
  );
}

function looksLikeColorTemplate(text: string): boolean {
  return /أي لون بتحب|which color would you like|الألوان المتاحة/i.test(text);
}

function looksLikeIdentityAsk(text: string): boolean {
  return /شو اسمك|شو رقم هاتفك|شو عنوان التوصيل|what is your (full )?name|phone number|delivery address/i.test(
    text
  );
}

// (a) focused watch + price question → price in reply, no color template
{
  const result = await runTurn({
    message: 'كم سعر ساعة؟',
    state: focusedWatchState(),
    llmText: 'ساعة اليد بـ200 ريال سعودي.',
    asksProductInfo: true,
  });
  assert(
    /200/.test(result.replyText) && /ريال|SAR/i.test(result.replyText),
    `2E-a price reply states 200 SAR, got: ${result.replyText}`,
  );
  assert(
    !looksLikeColorTemplate(result.replyText),
    `2E-a price reply must not be a color template, got: ${result.replyText}`,
  );
  assert(
    result.intent === 'product_query' || result.intent === 'browse',
    `2E-a intent browse/product_query, got ${result.intent}`,
  );
  assert(
    isBrowseAction(result) && result.next_action !== 'collect_info',
    `2E-a nextAction browse not collect_info, got ${result.next_action}`,
  );
}

// (b) greeting with focused product, empty cart → greeting, not color/field
{
  const result = await runTurn({
    message: 'السلام عليكم',
    state: focusedWatchState(),
    llmText: 'وعليكم السلام، أهلاً وسهلاً فيك!',
    nextAction: 'greet',
  });
  assert(
    /سلام|أهلا|welcome|hello/i.test(result.replyText),
    `2E-b greeting text preserved, got: ${result.replyText}`,
  );
  assert(
    !looksLikeColorTemplate(result.replyText),
    `2E-b greeting must not ask color, got: ${result.replyText}`,
  );
  assert(
    !looksLikeIdentityAsk(result.replyText),
    `2E-b greeting must not ask identity, got: ${result.replyText}`,
  );
  assert(
    result.next_action !== 'collect_info',
    `2E-b nextAction not collect_info, got ${result.next_action}`,
  );
}

// (c) watch details → details kept (price), not forced collect_info overwrite of model prose
{
  const result = await runTurn({
    message: 'شو تفاصيل الساعة',
    state: focusedWatchState(),
    llmText: 'الساعة سعرها 200 ريال، متوفرة بالأسود والأحمر.',
    asksProductInfo: true,
  });
  assert(
    /200/.test(result.replyText),
    `2E-c details keep price 200, got: ${result.replyText}`,
  );
  assert(
    result.next_action !== 'collect_info' || /200/.test(result.replyText),
    `2E-c must not replace details with bare collect template, got action=${result.next_action} text=${result.replyText}`,
  );
  assert(
    isBrowseAction(result) || /200/.test(result.replyText),
    `2E-c browse-like turn, got ${result.next_action}`,
  );
}

// (d) mobile availability
{
  const result = await runTurn({
    message: 'عندكم موبايلات؟',
    state: focusedWatchState({ extracted_entities: {}, last_recommended_products: [] }),
    llmText: 'الموبايل غير متوفر حالياً.',
    asksProductInfo: true,
  });
  assert(
    /غير متوفر|نفد|مو موجود|out of stock/i.test(result.replyText),
    `2E-d availability answer, got: ${result.replyText}`,
  );
  assert(
    !looksLikeColorTemplate(result.replyText),
    `2E-d availability must not ask color, got: ${result.replyText}`,
  );
  assert(
    result.next_action !== 'collect_info',
    `2E-d nextAction not collect_info, got ${result.next_action}`,
  );
}

// (e) order intent without color → color question IS correct
{
  const result = await runTurn({
    message: 'بدي اطلب الساعة',
    state: focusedWatchState(),
    llmText: 'أكيد، أي لون بتحب للساعة؟',
    nextAction: 'collect_info',
  });
  assert(
    looksLikeColorTemplate(result.replyText) || /أسود|أحمر/.test(result.replyText),
    `2E-e order without color asks color, got: ${result.replyText}`,
  );
  assert(
    result.updatedState.pending_bot_question === 'color' ||
      looksLikeColorTemplate(result.replyText),
    '2E-e pending color or color ask after order intent',
  );
}

// (f) pending color + unrelated price question → answer price, do not hijack
{
  const pendingState = focusedWatchState({
    pending_bot_question: 'color',
    pending_bot_question_product_id: REAL_TEST_WATCH.id,
    cart: {
      items: [
        {
          productId: REAL_TEST_WATCH.id,
          productName: REAL_TEST_WATCH.name,
          quantity: 1,
          unitPrice: 200,
          currency: 'SAR',
          addedAt: '2026-09-21T00:00:00.000Z',
        },
      ],
      status: 'building',
    },
  });
  const result = await runTurn({
    message: 'كم سعرها؟',
    state: pendingState,
    llmText: 'سعر الساعة 200 ريال.',
    asksProductInfo: true,
    recentMessages: [
      { role: 'assistant', content: 'أي لون بتحب؟ 🎨\n1) أسود — 2) أحمر' },
    ],
  });
  assert(
    /200/.test(result.replyText),
    `2E-f pending+price answers with price, got: ${result.replyText}`,
  );
  assert(
    !looksLikeColorTemplate(result.replyText) || /200/.test(result.replyText),
    `2E-f must not hijack into color-only template, got: ${result.replyText}`,
  );
  assert(
    result.next_action !== 'collect_info' || /200/.test(result.replyText),
    `2E-f price not replaced by bare collect_info, got ${result.next_action}: ${result.replyText}`,
  );
  // Unrelated question is not a bare color answer — pending must not attach a color.
  assert(
    !getCartItems(result.updatedState).some((item) => item.color),
    '2E-f unrelated question does not set a cart color',
  );
}

console.log(`browse-not-collect 2E: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  for (const item of failures) console.error(`FAIL: ${item}`);
  process.exit(1);
}
process.exit(0);
