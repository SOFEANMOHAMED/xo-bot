/**
 * V4 — size ask / pending extract / size confirm gate on processWithSalesGPT.
 * Color stays on orderColorPolicy. Run: npm run test-v4-size-pipeline
 */
import type { ConversationState, MerchantConfig, Product } from '../../core/types.js';
import { processWithSalesGPT } from './index.js';
import { REAL_TEST_MOBILE, REAL_TEST_WATCH } from './realTestCatalog.js';
import { buildAskColorMessage } from './orderColorPolicy.js';
import { buildAskVariantMessage, axisById } from './variantEngine/index.js';
import {
  resetHarness,
  setCatalog,
  setLlmReply,
} from './test_pipeline_harness_state.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const PERFUME: Product = {
  id: 'perfume-aed-220',
  name: 'عطر',
  price: 220,
  currency: 'AED',
  stock: 8,
  description: 'عطر رجالي',
  category: 'عطور',
  colors: [],
  sizes: ['50ml', '100ml'],
};

const DRESS: Product = {
  id: 'dress-usd-120',
  name: 'فستان',
  price: 120,
  currency: 'USD',
  stock: 4,
  description: 'فستان',
  category: 'فساتين',
  colors: ['أحمر', 'أسود'],
  sizes: ['S', 'M', 'L'],
};

const SHIRT_SIZED: Product = {
  id: 'shirt-usd-553',
  name: 'قميص',
  price: 553,
  currency: 'USD',
  stock: 529,
  description: 'قميص',
  category: 'قمصان',
  colors: [],
  sizes: ['s', 'm', 'l'],
};

const CATALOG: Product[] = [REAL_TEST_WATCH, SHIRT_SIZED, REAL_TEST_MOBILE, PERFUME, DRESS];

const LLM_SHIRT_SIZE_ASK =
  'القميص جودة عالية. السعر 553 دولار أمريكي. أي مقاس تفضله؟ عندنا مقاسات s, m و l.';

function merchant(): MerchantConfig {
  return {
    merchantId: '00000000-0000-4000-8000-000000000901',
    storeName: 'متجر اختبار',
    storeCurrency: 'AED',
    persona: 'friendly',
    botLanguage: 'arabic',
  };
}

function state(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    message_count: 2,
    extracted_entities: {},
    ...overrides,
  };
}

async function runTurn(input: {
  message: string;
  conversationState: ConversationState;
  llmText: string;
  nextAction: string;
  recentMessages?: { role: 'user' | 'assistant'; content: string }[];
  readyToConfirm?: boolean;
  extractedInfo?: Record<string, unknown>;
}) {
  resetHarness();
  setCatalog(CATALOG);
  setLlmReply({
    response_text: input.llmText,
    next_action: input.nextAction,
    customer_request: {
      wants_alternatives: false,
      asks_product_info: false,
      wants_photo: false,
      ready_to_confirm: input.readyToConfirm === true,
      wants_add_another: false,
    },
    extracted_info: input.extractedInfo || {},
  });
  return processWithSalesGPT({
    merchantId: merchant().merchantId,
    messageText: input.message,
    recentMessages: input.recentMessages || [],
    conversationState: input.conversationState,
    merchantConfig: merchant(),
    platform: 'playground',
  });
}

const sizeAxis = axisById(PERFUME, 'size')!;
const SIZE_ASK = buildAskVariantMessage('arabic', sizeAxis);
const COLOR_ASK = buildAskColorMessage('arabic', DRESS.colors || []);

// 1) Perfume order-ish turn → force size ask (not color, not confirm).
{
  const result = await runTurn({
    message: 'بدي العطر',
    conversationState: state({
      extracted_entities: { product_id: PERFUME.id, product_query: PERFUME.name },
      last_recommended_products: [PERFUME.id],
    }),
    llmText: 'تمام، نقدر نثبّت الطلب.',
    nextAction: 'collect_info',
    recentMessages: [{ role: 'user', content: 'شو العطور' }],
  });
  assert(/أي مقاس بتحب/.test(result.replyText), `perfume force size ask, got: ${result.replyText}`);
  assert(result.replyText.includes('50ml') && result.replyText.includes('100ml'), 'lists catalog sizes');
  assert(!/أي لون بتحب/.test(result.replyText), 'perfume must not ask color');
  assert(result.next_action === 'collect_info', `next ${result.next_action}`);
  assert(result.updatedState.pending_bot_question === 'size', 'binds pending size');
}

// 2) LLM confirm_order without size → size gate, not confirm.
{
  const result = await runTurn({
    message: 'أكد الطلب',
    conversationState: state({
      extracted_entities: {
        product_id: PERFUME.id,
        product_query: PERFUME.name,
        name: 'أحمد',
        phone: '0500000000',
        address: 'الرياض',
      },
      last_recommended_products: [PERFUME.id],
      awaiting_order_confirmation: true,
      salesgpt_stage_id: '8',
    }),
    llmText: 'تم تأكيد طلبك رقم 99',
    nextAction: 'confirm_order',
    readyToConfirm: true,
    recentMessages: [
      { role: 'assistant', content: 'نأكد الطلب؟' },
      { role: 'user', content: 'بدي العطر' },
    ],
  });
  assert(result.next_action !== 'confirm_order', `size gate must block confirm, got ${result.next_action}`);
  assert(/أي مقاس بتحب/.test(result.replyText), `gate asks size, got: ${result.replyText}`);
}

// 3) Pending size + bare 50ml → recorded via setLineVariant.
{
  const result = await runTurn({
    message: '50ml',
    conversationState: state({
      extracted_entities: { product_id: PERFUME.id, product_query: PERFUME.name },
      last_recommended_products: [PERFUME.id],
      pending_bot_question: 'size',
      pending_bot_question_product_id: PERFUME.id,
      cart: {
        items: [
          {
            lineId: 'line-perfume',
            productId: PERFUME.id,
            productName: PERFUME.name,
            quantity: 1,
            unitPrice: PERFUME.price,
            currency: PERFUME.currency,
            addedAt: '2026-09-24T00:00:00.000Z',
          },
        ],
        status: 'building',
        updatedAt: '2026-09-24T00:00:00.000Z',
      },
    }),
    llmText: 'رح أتجاهل هذا الرد.',
    nextAction: 'present_product',
    recentMessages: [{ role: 'assistant', content: SIZE_ASK }],
  });
  const line = result.updatedState.cart?.items?.find((row) => row.productId === PERFUME.id);
  assert(line?.size === '50ml', `records 50ml, got ${line?.size}`);
  assert(line?.variants?.size === '50ml', `variants.size, got ${line?.variants?.size}`);
  assert(result.next_action !== 'confirm_order', 'bare size is not confirm');
}

// 4) Pending size + value inside a longer sentence → not a selection.
{
  const result = await runTurn({
    message: '50ml غالي؟',
    conversationState: state({
      extracted_entities: { product_id: PERFUME.id, product_query: PERFUME.name },
      last_recommended_products: [PERFUME.id],
      pending_bot_question: 'size',
      pending_bot_question_product_id: PERFUME.id,
      cart: {
        items: [
          {
            lineId: 'line-perfume',
            productId: PERFUME.id,
            productName: PERFUME.name,
            quantity: 1,
            unitPrice: PERFUME.price,
            currency: PERFUME.currency,
            addedAt: '2026-09-24T00:00:00.000Z',
          },
        ],
        status: 'building',
      },
    }),
    llmText: 'السعر 220 درهم.',
    nextAction: 'present_product',
    recentMessages: [{ role: 'assistant', content: SIZE_ASK }],
  });
  const line = result.updatedState.cart?.items?.find((row) => row.productId === PERFUME.id);
  assert(!line?.size, `long sentence must not set size, got ${line?.size}`);
}

// 5) Numeric 2 while pending size → second catalog value.
{
  const result = await runTurn({
    message: '2',
    conversationState: state({
      extracted_entities: { product_id: PERFUME.id, product_query: PERFUME.name },
      last_recommended_products: [PERFUME.id],
      pending_bot_question: 'size',
      pending_bot_question_product_id: PERFUME.id,
      cart: {
        items: [
          {
            lineId: 'line-perfume',
            productId: PERFUME.id,
            productName: PERFUME.name,
            quantity: 1,
            unitPrice: PERFUME.price,
            currency: PERFUME.currency,
            addedAt: '2026-09-24T00:00:00.000Z',
          },
        ],
        status: 'building',
      },
    }),
    llmText: 'ignored',
    nextAction: 'present_product',
    recentMessages: [{ role: 'assistant', content: SIZE_ASK }],
  });
  const line = result.updatedState.cart?.items?.find((row) => row.productId === PERFUME.id);
  assert(line?.size === '100ml', `numeric 2 → 100ml, got ${line?.size}`);
}

// 6) Watch (colors, no sizes) still asks color — not size.
{
  const result = await runTurn({
    message: 'بدي الساعة',
    conversationState: state({
      extracted_entities: {
        product_id: REAL_TEST_WATCH.id,
        product_query: REAL_TEST_WATCH.name,
      },
      last_recommended_products: [REAL_TEST_WATCH.id],
    }),
    llmText: 'تمام نكمّل الطلب.',
    nextAction: 'collect_info',
  });
  assert(/أي لون بتحب/.test(result.replyText), `watch still asks color, got: ${result.replyText}`);
  assert(!/أي مقاس بتحب/.test(result.replyText), 'watch must not ask size');
  assert(result.updatedState.pending_bot_question === 'color', 'binds pending color');
}

// 7) Dress missing both + confirm → color gate wins (not size).
{
  const result = await runTurn({
    message: 'أكد',
    conversationState: state({
      extracted_entities: { product_id: DRESS.id, product_query: DRESS.name },
      last_recommended_products: [DRESS.id],
    }),
    llmText: 'تم التأكيد',
    nextAction: 'confirm_order',
    readyToConfirm: true,
  });
  assert(/أي لون بتحب/.test(result.replyText), `dress color first, got: ${result.replyText}`);
  assert(!/أي مقاس بتحب/.test(result.replyText), 'dress does not skip to size');
  assert(result.next_action !== 'confirm_order', 'dress not confirmed without variants');
}

// 8) Dress color filled + confirm → size ask.
{
  const result = await runTurn({
    message: 'أكد',
    conversationState: state({
      extracted_entities: {
        product_id: DRESS.id,
        product_query: DRESS.name,
        color: 'أحمر',
      },
      last_recommended_products: [DRESS.id],
      cart: {
        items: [
          {
            lineId: 'line-dress',
            productId: DRESS.id,
            productName: DRESS.name,
            quantity: 1,
            unitPrice: DRESS.price,
            currency: DRESS.currency,
            color: 'أحمر',
            addedAt: '2026-09-24T00:00:00.000Z',
          },
        ],
        status: 'building',
      },
    }),
    llmText: 'تم التأكيد',
    nextAction: 'confirm_order',
    readyToConfirm: true,
    recentMessages: [{ role: 'assistant', content: COLOR_ASK }],
  });
  assert(/أي مقاس بتحب/.test(result.replyText), `dress size after color, got: ${result.replyText}`);
  assert(result.next_action !== 'confirm_order', 'dress not confirmed without size');
}

// 9) Shirt (no colors) + LLM free size ask + bare M → record m, do not re-ask.
{
  const result = await runTurn({
    message: 'M',
    conversationState: state({
      extracted_entities: {
        product_id: SHIRT_SIZED.id,
        product_query: SHIRT_SIZED.name,
      },
      last_recommended_products: [SHIRT_SIZED.id],
    }),
    llmText: 'تمام، نكمّل الطلب.',
    nextAction: 'collect_info',
    recentMessages: [{ role: 'assistant', content: LLM_SHIRT_SIZE_ASK }],
  });
  assert(
    result.updatedState.extracted_entities?.size === 'm',
    `bare M records catalog m, got ${result.updatedState.extracted_entities?.size}`
  );
  assert(!/أي مقاس بتحب/.test(result.replyText), `must not re-ask size, got: ${result.replyText}`);
}

// 10) Colorless product: LLM extracted size must survive (do not wipe with color).
{
  const result = await runTurn({
    message: 'تمام',
    conversationState: state({
      extracted_entities: {
        product_id: PERFUME.id,
        product_query: PERFUME.name,
      },
      last_recommended_products: [PERFUME.id],
    }),
    llmText: 'نكمّل بياناتك.',
    nextAction: 'collect_info',
    extractedInfo: { size: '50ml' },
  });
  assert(
    result.updatedState.extracted_entities?.size === '50ml',
    `colorless must keep AI size, got ${result.updatedState.extracted_entities?.size}`
  );
  assert(!/أي مقاس بتحب/.test(result.replyText), `kept size must not force-ask, got: ${result.replyText}`);
}

console.log('test_v4_size_pipeline: PASS');
